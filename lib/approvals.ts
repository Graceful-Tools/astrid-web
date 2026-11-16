/**
 * Approvals (AWTD-1694): a Decision card whose answer runs the approved action.
 *
 * When the orchestration policy (AWTD-1693) says an action needs a person, the agent or the
 * server posts an **approval request** on the task. It is bound to ONE action and ONE full commit
 * sha, and it states what will run. A person the policy names as an escalation target decides it
 * (Approve or Decline); only then does anything run.
 *
 * **How a request is told from a comment.** The server sets `Comment.systemEventType` to
 * `APPROVAL_REQUEST:<action>:<sha>` and no public comment route accepts that column, so nobody can
 * make a reply that poses as a request. A decision is a reply to the request (`parentCommentId`)
 * carrying `APPROVAL_APPROVED` or `APPROVAL_DECLINED`, written by the server on the decider's
 * behalf. Nothing is ever read from comment text: an ordinary reply ("approved!", "ship it") is
 * never an approval.
 *
 * Browser-safe: no Node imports, no Prisma.
 */

/** What an approval can run. Both dispatch the production deploy; the workflow's own checks still apply. */
export const APPROVAL_ACTIONS = ['deploy', 'migrate'] as const
export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number]

export const APPROVAL_REQUEST_PREFIX = 'APPROVAL_REQUEST'
export const APPROVAL_APPROVED = 'APPROVAL_APPROVED'
export const APPROVAL_DECLINED = 'APPROVAL_DECLINED'

const FULL_SHA = /^[0-9a-f]{40}$/

export function isApprovalAction(value: unknown): value is ApprovalAction {
  return typeof value === 'string' && (APPROVAL_ACTIONS as readonly string[]).includes(value)
}

/** A full commit sha, lowercased; null for anything else (an abbreviation could match more than one commit). */
export function normalizeSha(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const sha = value.trim().toLowerCase()
  return FULL_SHA.test(sha) ? sha : null
}

export function approvalRequestMarker(action: ApprovalAction, sha: string): string {
  return `${APPROVAL_REQUEST_PREFIX}:${action}:${sha}`
}

export interface ApprovalRequestRef {
  action: ApprovalAction
  sha: string
}

/** The action and commit a request is bound to, or null when this is not a request. */
export function parseApprovalRequest(systemEventType: string | null | undefined): ApprovalRequestRef | null {
  if (!systemEventType) return null
  const [prefix, action, sha, ...rest] = systemEventType.split(':')
  if (prefix !== APPROVAL_REQUEST_PREFIX || rest.length || !isApprovalAction(action)) return null
  const full = normalizeSha(sha)
  return full ? { action, sha: full } : null
}

export interface ApprovalCommentLike {
  id: string
  parentCommentId?: string | null
  systemEventType?: string | null
  authorId?: string | null
  content?: string
  createdAt?: Date | string
}

export type ApprovalState =
  | { status: 'pending' }
  | { status: 'approved'; decidedBy: string | null; decisionId: string }
  | { status: 'declined'; decidedBy: string | null; decisionId: string; reason: string }

/** Where a request stands: pending until a decision reply exists; the first decision stands. */
export function approvalStateOf(requestId: string, comments: ApprovalCommentLike[]): ApprovalState {
  const decisions = comments
    .filter(
      c =>
        c.parentCommentId === requestId &&
        (c.systemEventType === APPROVAL_APPROVED || c.systemEventType === APPROVAL_DECLINED),
    )
    .sort((a, b) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime())
  const first = decisions[0]
  if (!first) return { status: 'pending' }
  if (first.systemEventType === APPROVAL_APPROVED) {
    return { status: 'approved', decidedBy: first.authorId ?? null, decisionId: first.id }
  }
  return { status: 'declined', decidedBy: first.authorId ?? null, decisionId: first.id, reason: first.content ?? '' }
}

export interface ApprovalRequestText {
  action: ApprovalAction
  sha: string
  /** What will run, in the requester's words: for a migration the SQL summary and the destructive-check result. */
  summary: string
}

const ACTION_LABEL: Record<ApprovalAction, string> = {
  deploy: 'Deploy to production',
  migrate: 'Deploy to production, applying pending migrations',
}

/** The request's visible body. The buttons come from the marker, not from this text. */
export function approvalRequestContent({ action, sha, summary }: ApprovalRequestText): string {
  return [
    `**Approval needed: ${ACTION_LABEL[action]}**`,
    '',
    `Commit \`${sha}\` only. A newer commit needs a new approval.`,
    '',
    summary.trim(),
    '',
    'Approve or Decline on this card. A reply in words is not an approval.',
  ].join('\n')
}

export function approvalDecisionContent(args: {
  decision: 'approve' | 'decline'
  by: string
  action: ApprovalAction
  sha: string
  reason?: string
}): string {
  const short = args.sha.slice(0, 8)
  if (args.decision === 'approve') return `${args.by} approved ${args.action} of \`${short}\`.`
  const why = args.reason?.trim()
  return `${args.by} declined ${args.action} of \`${short}\`.${why ? ` Reason: ${why}` : ''}`
}
