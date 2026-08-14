/**
 * Which Ready tasks an autonomous loop may take.
 *
 * `Ready` means "this is actionable". It does not mean "this is unclaimed", and
 * the two came apart the moment tasks started being assigned: a loop that works
 * everything in Ready will redo work a person is already doing, or write a
 * second fix for something Jon has half-finished.
 *
 * So the queue needs both conditions — on this board, AND unassigned or handed
 * to the agent deliberately. This module owns the second one.
 *
 * Lives in lib/ rather than inside scripts/ready-tasks.ts because that script
 * calls main() at import, so the rule could not otherwise be tested without
 * firing a network request.
 */

/**
 * The agent identity a loop runs as. Agent addresses are
 * `<mailbox>@<brand agent domain>` (lib/brand/agent-emails.ts); matching the
 * local part alone keeps a fork working, where the domain differs but the
 * mailbox does not.
 */
export const CLAUDE_MAILBOX = 'claude'

export interface AssignableTask {
  assigneeId?: string | null
  assignee?: { email?: string | null; name?: string | null } | null
}

/**
 * May an autonomous loop take this task?
 *
 * True when nobody has claimed it, or when the assignee is the agent itself.
 *
 * Deliberately conservative about missing data: `assignee` may be absent, null,
 * or present without an email depending on how the task was serialised. When a
 * task IS assigned but the identity cannot be confirmed, the safe reading is
 * "someone else's" — claiming it on a guess is the failure that costs duplicated
 * work, while skipping it costs one line of output telling Jon why.
 */
export function isClaimableByAgent(task: AssignableTask): boolean {
  if (!task.assigneeId) return true

  const email = task.assignee?.email
  if (!email) return false

  return email.toLowerCase().split('@')[0] === CLAUDE_MAILBOX
}

/** Human-readable owner, for explaining why a task was skipped. */
export function describeAssignee(task: AssignableTask): string {
  return task.assignee?.name || task.assignee?.email || task.assigneeId || 'unknown'
}
