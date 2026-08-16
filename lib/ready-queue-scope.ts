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
 * ONLY when it is assigned to the agent. Assignment is the handshake.
 *
 * Unassigned used to qualify too, on the reasoning that nobody had claimed it
 * (Jon, 2026-08-15: "only chose tasks assigned to Claude"). That reading made
 * `Ready` mean "actionable AND unclaimed", so anything dropped into Ready to
 * think about was fair game for a loop that would start on it within fifteen
 * minutes. Requiring the assignment inverts the default: nothing is the loop's
 * until someone hands it over, and Ready can go back to meaning only "ready".
 *
 * Still deliberately conservative about missing data: `assignee` may be absent,
 * null, or present without an email depending on how the task was serialised.
 * An assignment that cannot be confirmed reads as somebody else's — claiming on
 * a guess costs duplicated work, skipping costs one line of output saying why.
 */
export function isClaimableByAgent(task: AssignableTask): boolean {
  if (!task.assigneeId) return false

  const email = task.assignee?.email
  if (!email) return false

  return email.toLowerCase().split('@')[0] === CLAUDE_MAILBOX
}

/**
 * Human-readable owner, for explaining why a task was skipped.
 *
 * "unassigned" is now the COMMON skip, not an edge case, so it says so. Printing
 * `unknown` for it read as a data problem and sent a reader looking for a bug that
 * was not there — the task simply had not been handed over yet.
 */
export function describeAssignee(task: AssignableTask): string {
  if (!task.assigneeId) return 'unassigned'
  return task.assignee?.name || task.assignee?.email || task.assigneeId || 'unknown'
}
