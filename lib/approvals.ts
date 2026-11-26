/**
 * Approvals (AWTD-1694): when the orchestration policy says an action needs a person, the agent
 * or the server posts an approval card on the task. Tapping Approve runs exactly that action.
 *
 * What makes it an approval and not a reply:
 * - **The card is server-made.** It is a comment with `systemEventType: APPROVAL_REQUEST`, which no
 *   comment write can set, so a reply or a quoted marker never becomes one.
 * - **It is bound to one action and one full commit sha.** The sha rides in the card's last line
 *   and is sent to the deploy workflow as `expected_sha`; a newer main makes the workflow refuse,
 *   so a new commit needs a new card.
 * - **The decision is the endpoint's, never the reply's.** It is recorded as a child comment with
 *   `APPROVAL_APPROVED` / `APPROVAL_DECLINED`, authored by the person who decided, and only the
 *   policy's escalation targets (`escalateTo`) may.
 *
 * Browser-safe: no Node imports, no Prisma.
 */
import { escalateTo, type OrchestrationPolicy } from '@/lib/orchestration-policy'

export const APPROVAL_ACTIONS = ['deploy', 'migrate', 'promoteIdea', 'experimentStart', 'experimentStop'] as const
export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number]

/**
 * The Goal signals actions (ADEV-284). Their card binds to a 40-hex digest of the estimate or the
 * experiment snapshot it was asked about, in the place a deploy card keeps its commit sha: a newer
 * estimate or snapshot has a different digest and needs a new card.
 */
export const GOAL_ACTIONS = ['promoteIdea', 'experimentStart', 'experimentStop'] as const
export type GoalAction = (typeof GOAL_ACTIONS)[number]
export const isGoalAction = (action: ApprovalAction): action is GoalAction => (GOAL_ACTIONS as readonly string[]).includes(action)

export const APPROVAL_REQUEST = 'APPROVAL_REQUEST'
export const APPROVAL_APPROVED = 'APPROVAL_APPROVED'
export const APPROVAL_DECLINED = 'APPROVAL_DECLINED'
export const APPROVAL_DECISION_TYPES = [APPROVAL_APPROVED, APPROVAL_DECLINED] as const

export type ApprovalVerdict = 'approve' | 'decline'

export interface ApprovalRequest {
  action: ApprovalAction
  /** The full 40-character commit the approval is for; for a Goal signals action, the snapshot digest. */
  sha: string
}

const SHA = /^[0-9a-f]{40}$/
const MARKER = /^APPROVAL-REQUEST: (\w+) ([0-9a-f]{40})$/

export const isApprovalAction = (value: unknown): value is ApprovalAction =>
  typeof value === 'string' && (APPROVAL_ACTIONS as readonly string[]).includes(value)

export const isFullSha = (value: unknown): value is string => typeof value === 'string' && SHA.test(value)

/** The comment body: what will run, then the marker line that binds it to its action and commit. */
export function buildApprovalRequestContent(request: ApprovalRequest, summary: string): string {
  return `${summary.trim()}\n\nAPPROVAL-REQUEST: ${request.action} ${request.sha}`
}

/** The action and commit a card is bound to, or null when the body does not end in the marker. */
export function parseApprovalRequest(content: string): ApprovalRequest | null {
  const last = content.trimEnd().split('\n').pop() ?? ''
  const match = MARKER.exec(last)
  if (!match || !isApprovalAction(match[1])) return null
  return { action: match[1], sha: match[2] }
}

/** The card body without its marker line, for display. */
export function approvalSummary(content: string): string {
  return parseApprovalRequest(content) ? content.trimEnd().split('\n').slice(0, -1).join('\n').trim() : content
}

/** Only the people the policy names as escalation targets may decide. */
export function canDecideApproval(
  policy: OrchestrationPolicy,
  userId: string,
  listOwnerId: string,
  taskCreatorId?: string | null,
): boolean {
  return escalateTo(policy, listOwnerId, taskCreatorId).notify.includes(userId.trim())
}

/**
 * The inputs for `production-deployment.yml`. `migrate` is the one that asserts, on the record, that
 * the code which stopped using a dropped shape is already live (docs/CLI_OPERATIONS.md, two deploys),
 * so it is the only one that sets `allow_destructive_migrations`.
 */
export function deployDispatchInputs(request: ApprovalRequest): Record<string, string> {
  return {
    skip_tests: 'false',
    allow_destructive_migrations: request.action === 'migrate' ? 'true' : 'false',
    expected_sha: request.sha,
  }
}
