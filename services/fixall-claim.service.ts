import {
  type FixallClaimRequest,
  buildAtomicFixallClaimWhere,
  buildFixallClaimData,
  fixallClaimAgentEmail,
  handedOffParkComment,
  nativeCopilotClaimMarker,
  redoClaimComment,
  pendingDeployHandoff,
} from "@/lib/fixall-claim"
import { prisma } from "@/lib/prisma"
import { pendingAgentHandback } from '@/lib/agent-handback'
import { parseBlockedConditions } from '@/lib/ready-queue-scope'
import { DOING_STATUS_ROLE, READY_STATUS_ROLE } from '@/lib/task-status'
import type { Prisma } from '@prisma/client'
import type { RuntimeBindingDenial } from '@/lib/ai/runtime-binding-resolver'
import { denyUnsupportedBoundTransport, gateBoundClaim, runFencedClaim } from '@/lib/runtime-binding/claim-fence'

export type FixallClaimResult =
  | { status: "claimed"; assigneeEmail: string }
  | { status: "agent-unavailable" }
  | { status: "conflict" }
  | { status: "handed-off"; sha: string }
  /** A bound board refused this claim (AWTD-1669). Never a fall-back. */
  | { status: "binding-denied"; denial: RuntimeBindingDenial }

/** Who is claiming, beyond the agent: the authenticated runtime and person (AWTD-1669). */
export interface FixallClaimContext {
  /** The caller's OAuth client id; null for any other authentication. */
  principal?: string | null
  actorUserId?: string
}

type ClaimWrite = (db: Prisma.TransactionClient) => Promise<FixallClaimResult>

/**
 * Take a task for the harness that asked, in ONE conditional update.
 *
 * The identity comes from the claim rather than a constant: a Claude Code loop
 * claiming as Copilot would hand its own work to a different harness, which is
 * why the local loops could not use this endpoint at all before.
 *
 * Exclusivity lives in the pairing of `buildAtomicFixallClaimWhere` (requires
 * Ready) with `buildFixallClaimData` (writes Doing) — see the comment on the
 * latter. `updateMany` reports how many rows matched, so a count of 0 is a
 * genuine "someone else got there first" rather than an error to retry.
 */
export async function claimFixallTask(
  taskId: string,
  claim: FixallClaimRequest,
  context: FixallClaimContext = {},
): Promise<FixallClaimResult> {
  const expectedEmail = fixallClaimAgentEmail(claim.agent)
  const agent = await prisma.user.findUnique({
    where: { email: expectedEmail },
    select: { id: true, email: true, isAIAgent: true, isActive: true },
  })
  if (
    !agent ||
    agent.email.toLowerCase() !== expectedEmail.toLowerCase() ||
    !agent.isAIAgent ||
    !agent.isActive
  ) {
    return { status: "agent-unavailable" }
  }

  // The runtime-binding pilot (AWTD-1669). Off, or on an unbound task, this is
  // `legacy` with no query, and every write below runs exactly as before. On a
  // bound task every write goes through the capacity fence instead.
  const principal = context.principal ?? null
  const actorUserId = context.actorUserId ?? agent.id
  const operation = `claim-fixall:${claim.action}`
  const gateInput = {
    taskId,
    agentEmail: agent.email,
    executionBoardId: claim.listId ?? claim.resume?.listId ?? null,
    principal,
  }
  const binding = await gateBoundClaim(gateInput, { actorUserId, operation })
  if (binding.kind === 'denied') return { status: 'binding-denied', denial: binding.denial }
  if (binding.kind === 'bound' && claim.nativeDispatch) {
    return {
      status: 'binding-denied',
      denial: await denyUnsupportedBoundTransport(binding.plan, gateInput, { actorUserId, operation }),
    }
  }
  const legacyClient = prisma as unknown as Prisma.TransactionClient
  /** A single write: legacy runs it on the client as before; bound runs it fenced. */
  const write = (fn: ClaimWrite, takesCapacity = true) =>
    binding.kind === 'bound' ? fenced(fn, takesCapacity) : fn(legacyClient)
  /** A transactional write: legacy keeps its own $transaction; bound runs inside the fence's. */
  const transact = (fn: ClaimWrite, takesCapacity = true) =>
    binding.kind === 'bound' ? fenced(fn, takesCapacity) : prisma.$transaction(fn)
  const fenced = async (fn: ClaimWrite, takesCapacity: boolean): Promise<FixallClaimResult> => {
    if (binding.kind !== 'bound') return fn(legacyClient)
    const outcome = await runFencedClaim({
      plan: binding.plan,
      gate: gateInput,
      actorUserId,
      operation,
      takesCapacity,
      write: fn,
      started: result => takesCapacity && result.status === 'claimed',
    })
    if (outcome.kind === 'denied') return { status: 'binding-denied', denial: outcome.denial }
    return outcome.kind === 'stale' ? { status: 'conflict' } : outcome.value
  }

  if (claim.action === 'resume') {
    const expected = claim.resume
    if (!expected) return { status: 'conflict' }
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        completed: true, statusRole: true, assigneeId: true, updatedAt: true,
        assignee: { select: { isAIAgent: true } }, lists: { select: { id: true } },
        comments: { orderBy: { createdAt: 'desc' }, take: 100,
          select: { id: true, authorId: true, content: true, createdAt: true, updatedAt: true,
            author: { select: { isAIAgent: true } } } },
      },
    })
    const actual = task && pendingAgentHandback({ task, agentId: agent.id, mailbox: claim.agent, listId: expected.listId })
    if (!actual || Object.keys(expected).some(key =>
      expected[key as keyof typeof expected] !== actual[key as keyof typeof actual])) return { status: 'conflict' }
    return write(async db => {
      const result = await db.task.updateMany({
        where: {
          // A handback sits in the Inbox (no status), assigned to the person (R4).
          id: taskId, completed: false, statusRole: null,
          assigneeId: expected.assigneeId, updatedAt: task.updatedAt,
          lists: { some: { id: expected.listId } },
          AND: [
            { OR: [{ dueDateTime: null }, { dueDateTime: { lte: new Date() } }] },
            { comments: { none: { updatedAt: { gt: new Date(expected.commentWatermark) } } } },
            ...task.comments.filter(comment => [expected.handbackCommentId, expected.replyCommentId].includes(comment.id))
              .map(comment => ({ comments: { some: {
                id: comment.id, authorId: comment.authorId, content: comment.content, updatedAt: comment.updatedAt,
              } } })),
          ],
        },
        data: buildFixallClaimData({ agentId: agent.id, claim }),
      })
      return result.count === 1 ? { status: 'claimed', assigneeEmail: agent.email } : { status: 'conflict' }
    })
  }

  if (claim.nativeDispatch) {
    const nativeDispatch = claim.nativeDispatch
    const listId = claim.listId
    if (!listId) return { status: 'conflict' }
    return transact(async (tx): Promise<FixallClaimResult> => {
      const result = await tx.task.updateMany({
        where: buildAtomicFixallClaimWhere({ taskId, agentId: agent.id, claim, now: new Date() }),
        data: buildFixallClaimData({ agentId: agent.id, claim }),
      })
      if (result.count !== 1) return { status: 'conflict' }
      await tx.comment.create({ data: {
        taskId, authorId: agent.id,
        content: nativeCopilotClaimMarker(listId, taskId, nativeDispatch),
      } })
      return { status: 'claimed', assigneeEmail: agent.email }
    })
  }

  // A handoff somebody asked to have redone: claimable, but the claim marks the
  // new attempt so the old marker stops reading as finished work.
  let redoOf: string | null = null
  if (claim.action === 'ready') {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { comments: { orderBy: { createdAt: 'desc' }, take: 100, select: { content: true, createdAt: true } } },
    })
    const sha = task ? pendingDeployHandoff(task.comments) : null
    redoOf = task && !sha ? parseBlockedConditions(task.comments.map(comment => ({
      content: comment.content, createdAt: comment.createdAt.toISOString(),
    }))).awaitingDeploy : null
    if (sha) {
      // Put it back rather than only refusing: left in Ready, every run would
      // wake for it and be refused again. Finished work awaiting its deploy
      // stays in Doing (R6); its assignee is left as it is.
      // Parking ends no run and starts none, so it takes no capacity.
      return transact(async (tx): Promise<FixallClaimResult> => {
        const parked = await tx.task.updateMany({
          where: { id: taskId, completed: false, statusRole: READY_STATUS_ROLE },
          data: { statusRole: DOING_STATUS_ROLE },
        })
        if (parked.count === 1) {
          await tx.comment.create({ data: { taskId, authorId: agent.id, content: handedOffParkComment(sha) } })
        }
        return { status: 'handed-off', sha }
      }, false)
    }
  }

  if (redoOf) {
    const previous = redoOf
    return transact(async (tx): Promise<FixallClaimResult> => {
      const claimed = await tx.task.updateMany({
        where: buildAtomicFixallClaimWhere({ taskId, agentId: agent.id, claim, now: new Date() }),
        data: buildFixallClaimData({ agentId: agent.id, claim }),
      })
      if (claimed.count !== 1) return { status: 'conflict' }
      await tx.comment.create({ data: { taskId, authorId: agent.id, content: redoClaimComment(previous) } })
      return { status: 'claimed', assigneeEmail: agent.email }
    })
  }

  // A pause parks the agent's own run in the Inbox: it frees capacity, never takes it.
  return write(async db => {
    const result = await db.task.updateMany({
      where: buildAtomicFixallClaimWhere({
        taskId,
        agentId: agent.id,
        claim,
        now: new Date(),
      }),
      data: buildFixallClaimData({ agentId: agent.id, claim }),
    })

    return result.count === 1
      ? { status: "claimed", assigneeEmail: agent.email }
      : { status: "conflict" }
  }, claim.action !== 'pause')
}
