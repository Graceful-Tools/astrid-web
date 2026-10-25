import {
  type FixallClaimRequest,
  buildAtomicFixallClaimWhere,
  buildFixallClaimData,
  fixallClaimAgentEmail,
  nativeCopilotClaimMarker,
} from "@/lib/fixall-claim"
import { prisma } from "@/lib/prisma"
import { pendingAgentHandback } from '@/lib/agent-handback'

export type FixallClaimResult =
  | { status: "claimed"; assigneeEmail: string }
  | { status: "agent-unavailable" }
  | { status: "conflict" }

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
    const result = await prisma.task.updateMany({
      where: {
        id: taskId, completed: false, statusRole: 'waiting',
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
  }

  if (claim.nativeDispatch) {
    const nativeDispatch = claim.nativeDispatch
    const listId = claim.listId
    if (!listId) return { status: 'conflict' }
    return prisma.$transaction(async (tx): Promise<FixallClaimResult> => {
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

  const result = await prisma.task.updateMany({
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
}
