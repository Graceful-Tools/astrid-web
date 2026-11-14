/**
 * Is a run's claim on a task still its own? (AWTD-1658)
 *
 * The atomic claim (scripts/claim-fixall-task.ts) stops two runs STARTING a task. It is taken
 * once and never looked at again, while a task lives long enough for the board to change under
 * it: a peer on another machine finishes it, a person reassigns it, release-stuck-doing.ts
 * takes it back from a run that looked dead. On 2026-11-13 an interactive run and a scheduled
 * run both finished one astrid-windows task that way.
 *
 * So a run re-reads the task once more, at the one moment where being wrong is expensive:
 * before it merges. Pure, so the rule is tested; scripts/check-claim.ts does the read.
 */

export interface ClaimedTaskView {
  completed?: boolean | null
  statusRole?: string | null
  assignee?: { email?: string | null } | null
}

export type ClaimVerdict = { held: true } | { held: false; reason: string }

/** The statuses a held claim can be in: being worked, or finished and awaiting release. */
const HELD_STATUSES = new Set(['doing', 'testing'])

export function claimVerdict(task: ClaimedTaskView, agentEmail: string): ClaimVerdict {
  if (task.completed) return { held: false, reason: 'the task is already complete' }
  const status = task.statusRole ?? null
  if (!status || !HELD_STATUSES.has(status)) {
    return { held: false, reason: `the task is in ${status ?? 'the Inbox'}, not Doing` }
  }
  const holder = task.assignee?.email?.trim().toLowerCase() ?? null
  if (holder !== agentEmail.trim().toLowerCase()) {
    return { held: false, reason: `the task is assigned to ${holder ?? 'nobody'}, not ${agentEmail}` }
  }
  return { held: true }
}
