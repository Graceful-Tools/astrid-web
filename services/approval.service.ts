/**
 * Approvals (AWTD-1694; the rules and comment markers are in lib/approvals.ts).
 *
 * - **Request** (`requestApproval`): anyone who can see the task may ask. It is refused when the
 *   policy already lets the agent do the action alone, so a card always means a person is needed.
 *   The same action and commit never has two open cards.
 * - **Decide** (`decideApproval`): only a person the policy names as an escalation target. The
 *   decision is a reply written by the server, carrying who decided. Approve dispatches the
 *   production deploy through the GitHub App, pinned to the request's commit; Decline leaves the
 *   task open with the reason. The first decision stands; a second is refused.
 */
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { userCanAccessTask } from '@/services/task.service'
import { broadcastCommentCreated, COMMENT_INCLUDE } from '@/services/comment.service'
import { effectivePolicyForList } from '@/services/orchestration-policy.service'
import { escalateTo, mayAgent, type MigrationKind } from '@/lib/orchestration-policy'
import { dispatchProductionDeploy, type DeployDispatch } from '@/lib/github/dispatch-production-deploy'
import {
  approvalDecisionContent,
  approvalRequestContent,
  approvalRequestMarker,
  approvalStateOf,
  isApprovalAction,
  normalizeSha,
  parseApprovalRequest,
  APPROVAL_APPROVED,
  APPROVAL_DECLINED,
  APPROVAL_REQUEST_PREFIX,
} from '@/lib/approvals'

const log = createLogger('services.approval')

type Status = 400 | 403 | 404 | 409 | 502
export type ApprovalResult<T> = { ok: true; value: T } | { ok: false; status: Status; error: string }

const fail = (status: Status, error: string): { ok: false; status: Status; error: string } => ({ ok: false, status, error })

const DECISION_TYPES = [APPROVAL_APPROVED, APPROVAL_DECLINED]

const TASK_SELECT = {
  id: true,
  title: true,
  creatorId: true,
  assigneeId: true,
  lists: {
    select: {
      id: true,
      name: true,
      ownerId: true,
      privacy: true,
      githubRepositoryId: true,
      listMembers: { select: { userId: true, role: true } },
    },
  },
} as const

async function loadTask(taskId: string, userId: string) {
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: TASK_SELECT })
  if (!task || !userCanAccessTask(task as never, userId)) return null
  return task
}

type LoadedTask = NonNullable<Awaited<ReturnType<typeof loadTask>>>

/** The board a task's approvals are governed by: the one tied to a repository, else its first. */
function governingList(task: LoadedTask) {
  return task.lists.find(list => list.githubRepositoryId) ?? task.lists[0] ?? null
}

const audience = (task: LoadedTask) => ({ ...task, assignee: null }) as never

export interface RequestApprovalInput {
  taskId: string
  /** The caller, for the access check. */
  userId: string
  /** Who the card is signed as: the agent when one is asking. */
  authorId: string
  /** The requester's mailbox, which the policy's routing and autonomy are asked about. */
  agent: string
  action: unknown
  sha: unknown
  summary: unknown
  migration?: unknown
}

export async function requestApproval(input: RequestApprovalInput): Promise<ApprovalResult<{ commentId: string; created: boolean }>> {
  const task = await loadTask(input.taskId, input.userId)
  if (!task) return fail(404, 'Task not found or access denied')
  if (!isApprovalAction(input.action)) return fail(400, 'action must be `deploy` or `migrate`')
  const sha = normalizeSha(input.sha)
  if (!sha) return fail(400, 'sha must be the full 40-character commit sha')
  if (typeof input.summary !== 'string' || !input.summary.trim()) {
    return fail(400, 'summary is required: say exactly what will run')
  }
  if (input.migration !== undefined && input.migration !== 'additive' && input.migration !== 'destructive') {
    return fail(400, 'migration must be `additive` or `destructive`')
  }
  const list = governingList(task)
  const policy = list ? await effectivePolicyForList(list.id) : null
  if (!policy) return fail(404, 'Task is on no board')
  const may =
    input.action === 'migrate'
      ? mayAgent(policy, input.agent, 'migrate', (input.migration as MigrationKind | undefined) ?? null)
      : mayAgent(policy, input.agent, 'deploy')
  if (may.decision === 'allowed') return fail(409, `The policy lets ${input.agent} ${input.action} without approval`)

  const marker = approvalRequestMarker(input.action, sha)
  const thread = await prisma.comment.findMany({
    where: { taskId: task.id, OR: [{ systemEventType: marker }, { systemEventType: { in: DECISION_TYPES } }] },
    select: { id: true, parentCommentId: true, systemEventType: true, authorId: true, content: true, createdAt: true },
  })
  const open = thread.find(c => c.systemEventType === marker && approvalStateOf(c.id, thread).status === 'pending')
  if (open) return { ok: true, value: { commentId: open.id, created: false } }

  const comment = await prisma.comment.create({
    data: {
      taskId: task.id,
      authorId: input.authorId,
      type: 'MARKDOWN',
      systemEventType: marker,
      content: approvalRequestContent({ action: input.action, sha, summary: input.summary }),
    },
    include: COMMENT_INCLUDE,
  })
  broadcastCommentCreated(comment, audience(task), input.authorId)
  return { ok: true, value: { commentId: comment.id, created: true } }
}

export interface DecideApprovalInput {
  taskId: string
  requestId: string
  userId: string
  userName: string
  decision: unknown
  reason?: unknown
}

export interface DecisionOutcome {
  decisionId: string
  status: 'approved' | 'declined'
  dispatched: boolean
}

export async function decideApproval(
  input: DecideApprovalInput,
  dispatch: (repository: string, sha: string) => Promise<DeployDispatch> = dispatchProductionDeploy,
): Promise<ApprovalResult<DecisionOutcome>> {
  if (input.decision !== 'approve' && input.decision !== 'decline') return fail(400, 'decision must be `approve` or `decline`')
  const approve = input.decision === 'approve'
  const task = await loadTask(input.taskId, input.userId)
  if (!task) return fail(404, 'Task not found or access denied')
  const request = await prisma.comment.findFirst({
    where: { id: input.requestId, taskId: task.id, systemEventType: { startsWith: `${APPROVAL_REQUEST_PREFIX}:` } },
    select: { id: true, systemEventType: true },
  })
  const bound = parseApprovalRequest(request?.systemEventType)
  if (!request || !bound) return fail(404, 'Approval request not found')

  const list = governingList(task)
  const policy = list ? await effectivePolicyForList(list.id) : null
  if (!list || !policy) return fail(404, 'Task is on no board')
  const { notify } = escalateTo(policy, list.ownerId ?? '', task.creatorId)
  if (!notify.includes(input.userId)) {
    return fail(403, 'Only the people the orchestration policy names to decide can approve or decline')
  }
  if (approve && !list.githubRepositoryId) return fail(409, 'This board has no connected GitHub repository to deploy from')

  const decided = () =>
    prisma.comment.findMany({
      where: { taskId: task.id, parentCommentId: request.id, systemEventType: { in: DECISION_TYPES } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    })
  if ((await decided()).length) return fail(409, 'This approval was already decided')

  // The decision row is the lock: written first, and withdrawn if another decision beat it, so an
  // approval dispatches at most once.
  const decision = await prisma.comment.create({
    data: {
      taskId: task.id,
      authorId: input.userId,
      parentCommentId: request.id,
      type: 'TEXT',
      systemEventType: approve ? APPROVAL_APPROVED : APPROVAL_DECLINED,
      content: approvalDecisionContent({
        decision: approve ? 'approve' : 'decline',
        by: input.userName,
        action: bound.action,
        sha: bound.sha,
        reason: typeof input.reason === 'string' ? input.reason : undefined,
      }),
    },
    include: COMMENT_INCLUDE,
  })
  if ((await decided())[0]?.id !== decision.id) {
    await prisma.comment.delete({ where: { id: decision.id } })
    return fail(409, 'This approval was already decided')
  }
  broadcastCommentCreated(decision, audience(task), input.userId)

  if (!approve) return { ok: true, value: { decisionId: decision.id, status: 'declined', dispatched: false } }

  const sent = await dispatch(list.githubRepositoryId as string, bound.sha)
  if (!sent.ok) {
    log.warn({ taskId: task.id, reason: sent.reason }, 'Approved deploy was not dispatched')
    await prisma.comment.create({
      data: {
        taskId: task.id,
        authorId: input.userId,
        parentCommentId: request.id,
        type: 'TEXT',
        content: `The deploy of \`${bound.sha.slice(0, 8)}\` did not start: ${sent.message}. It needs a new approval.`,
      },
    })
    return fail(sent.reason === 'main_moved' ? 409 : 502, `Approved, but the deploy did not start: ${sent.message}`)
  }
  return { ok: true, value: { decisionId: decision.id, status: 'approved', dispatched: true } }
}
