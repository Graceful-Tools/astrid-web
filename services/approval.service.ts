/**
 * Approval cards (AWTD-1694). lib/approvals.ts says what makes an approval one; this is the part
 * that touches the database and GitHub.
 *
 * - `requestApproval` posts the card (a comment with `systemEventType: APPROVAL_REQUEST`).
 * - `decideApproval` records Approve or Decline as a child comment authored by the person who
 *   decided, and on Approve dispatches `production-deployment.yml` through the GitHub App with the
 *   card's own commit as `expected_sha`. The decision is first-write-wins on the card.
 */
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { COMMENT_INCLUDE } from '@/services/comment.service'
import { carryOutApprovedGoalAction } from '@/services/goal-action.service'
import { getGitHubApp, githubAppConfigured } from '@/lib/github/app'
import { effectiveOrchestrationPolicy } from '@/lib/core-rules/orchestration-core'
import { defaultOrchestrationPolicy, parsePolicyOverride, type OrchestrationPolicy } from '@/lib/orchestration-policy'
import {
  APPROVAL_APPROVED,
  APPROVAL_DECISION_TYPES,
  APPROVAL_DECLINED,
  APPROVAL_REQUEST,
  buildApprovalRequestContent,
  canDecideApproval,
  deployDispatchInputs,
  isGoalAction,
  parseApprovalRequest,
  type ApprovalRequest,
  type ApprovalVerdict,
} from '@/lib/approvals'

const log = createLogger('services.approval')

export const PRODUCTION_WORKFLOW = 'production-deployment.yml'

export type ApprovalResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: 400 | 403 | 404 | 409 | 502; error: string; code?: string }

const fail = (status: 400 | 403 | 404 | 409 | 502, error: string, code?: string): { ok: false; status: typeof status; error: string; code?: string } =>
  code ? { ok: false, status, error, code } : { ok: false, status, error }

const TASK_SELECT = {
  id: true,
  creatorId: true,
  completed: true,
  lists: {
    select: {
      id: true,
      ownerId: true,
      githubRepositoryId: true,
      orchestrationPolicy: true,
      project: { select: { orchestrationPolicy: true } },
    },
  },
} as const

type LoadedTask = NonNullable<Awaited<ReturnType<typeof loadTask>>>

function loadTask(taskId: string) {
  return prisma.task.findUnique({ where: { id: taskId }, select: TASK_SELECT })
}

function overrideOf(value: unknown) {
  const parsed = parsePolicyOverride(value)
  return parsed.ok ? parsed.value : null
}

/** Fails closed to the default policy, where the list owner is the only escalation target. */
function policyFor(list: LoadedTask['lists'][number]): OrchestrationPolicy {
  const answer = effectiveOrchestrationPolicy({
    project: overrideOf(list.project?.orchestrationPolicy),
    list: overrideOf(list.orchestrationPolicy),
  })
  return answer.ok ? answer.value : defaultOrchestrationPolicy()
}

/** The first board with a repository to deploy; the board whose policy governs the card. */
function governingList(task: LoadedTask) {
  return task.lists.find(list => list.githubRepositoryId) ?? task.lists[0] ?? null
}

export interface RequestApprovalArgs {
  taskId: string
  authorId: string
  request: ApprovalRequest
  /** What will run, in plain language: the SQL summary and the destructive-check result for a migration. */
  summary: string
}

export async function requestApproval(args: RequestApprovalArgs) {
  const content = buildApprovalRequestContent(args.request, args.summary)
  const existing = await prisma.comment.findFirst({
    where: { taskId: args.taskId, systemEventType: APPROVAL_REQUEST, content },
    select: { id: true, replies: { where: { systemEventType: { in: [...APPROVAL_DECISION_TYPES] } }, select: { id: true } } },
  })
  // The same card for the same action and commit is one card, until it has been answered.
  if (existing && existing.replies.length === 0) return { ok: true as const, value: { id: existing.id, created: false } }

  const comment = await prisma.comment.create({
    data: { taskId: args.taskId, authorId: args.authorId, content, type: 'MARKDOWN', systemEventType: APPROVAL_REQUEST },
    select: { id: true },
  })
  return { ok: true as const, value: { id: comment.id, created: true } }
}

async function dispatchDeploy(task: LoadedTask, request: ApprovalRequest): Promise<ApprovalResult<{ dispatched: true }>> {
  const repository = governingList(task)?.githubRepositoryId
  const [owner, repo] = repository?.split('/') ?? []
  if (!owner || !repo) return fail(409, 'This board has no GitHub repository to deploy', 'NO_REPOSITORY')
  if (!githubAppConfigured()) return fail(502, 'The GitHub App is not configured', 'GITHUB_APP_NOT_CONFIGURED')
  try {
    const app = getGitHubApp()
    const { data: installation } = await app.octokit.request('GET /repos/{owner}/{repo}/installation', { owner, repo })
    const octokit = await app.getInstallationOctokit(installation.id)
    await octokit.request('POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches', {
      owner,
      repo,
      workflow_id: PRODUCTION_WORKFLOW,
      ref: 'main',
      inputs: deployDispatchInputs(request),
    })
    return { ok: true, value: { dispatched: true } }
  } catch (error) {
    log.error({ err: error, owner, repo }, 'Approved deploy could not be dispatched')
    return fail(502, 'The deploy could not be dispatched through the GitHub App', 'DISPATCH_FAILED')
  }
}

export interface DecideApprovalArgs {
  taskId: string
  commentId: string
  userId: string
  verdict: ApprovalVerdict
  reason?: string | null
}

export async function decideApproval(args: DecideApprovalArgs) {
  const task = await loadTask(args.taskId)
  const list = task ? governingList(task) : null
  if (!task || !list) return fail(404, 'Task not found')

  const card = await prisma.comment.findFirst({
    where: { id: args.commentId, taskId: args.taskId, systemEventType: APPROVAL_REQUEST },
    select: { id: true, content: true },
  })
  const request = card ? parseApprovalRequest(card.content) : null
  if (!card || !request) return fail(404, 'Approval request not found')

  if (!canDecideApproval(policyFor(list), args.userId, list.ownerId, task.creatorId)) {
    return fail(403, 'Only the people this board names as escalation targets can decide', 'NOT_AN_APPROVER')
  }

  const reason = args.reason?.trim() || null
  if (args.verdict === 'decline' && !reason) return fail(400, 'Say why you are declining', 'REASON_REQUIRED')

  // First write wins: the decision row is created only while the card has none.
  const decided = await prisma.$transaction(async tx => {
    const prior = await tx.comment.findFirst({
      where: { parentCommentId: card.id, systemEventType: { in: [...APPROVAL_DECISION_TYPES] } },
      select: { id: true },
    })
    if (prior) return null
    return tx.comment.create({
      data: {
        taskId: args.taskId,
        authorId: args.userId,
        parentCommentId: card.id,
        type: 'MARKDOWN',
        systemEventType: args.verdict === 'approve' ? APPROVAL_APPROVED : APPROVAL_DECLINED,
        content:
          args.verdict === 'approve'
            ? `Approved ${request.action} of ${request.sha.slice(0, 8)}`
            : `Declined ${request.action} of ${request.sha.slice(0, 8)}: ${reason}`,
      },
      include: COMMENT_INCLUDE,
    })
  })
  if (!decided) return fail(409, 'This approval was already decided', 'ALREADY_DECIDED')

  if (args.verdict === 'decline') return { ok: true as const, value: { verdict: args.verdict, comment: decided, dispatched: false } }

  // A Goal signals card runs its own action, not a deploy (ADEV-284).
  if (isGoalAction(request.action)) {
    const carried = await carryOutApprovedGoalAction(args.taskId, { ...request, action: request.action }, args.userId)
    if (!carried.ok) {
      await prisma.comment.create({
        data: {
          taskId: args.taskId,
          authorId: args.userId,
          parentCommentId: card.id,
          type: 'MARKDOWN',
          content: `The approved ${request.action} did not run: ${carried.error}.`,
        },
      })
      return fail(carried.status, carried.error, carried.code)
    }
    return { ok: true as const, value: { verdict: args.verdict, comment: decided, dispatched: true } }
  }

  const dispatch = await dispatchDeploy(task, request)
  if (!dispatch.ok) {
    // The approval stands as recorded, but nothing ran; say so on the card rather than leave it looking done.
    await prisma.comment.create({
      data: {
        taskId: args.taskId,
        authorId: args.userId,
        parentCommentId: card.id,
        type: 'MARKDOWN',
        content: `The approved ${request.action} did not start: ${dispatch.error}. Dispatch production-deployment.yml by hand with expected_sha=${request.sha}.`,
      },
    })
    return dispatch
  }
  return { ok: true as const, value: { verdict: args.verdict, comment: decided, dispatched: true } }
}
