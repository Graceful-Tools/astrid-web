/**
 * Why an agent's queue is empty, in words the caller can act on (AWTD-845, AWTD-871). Moved out of
 * lib/agent-queue.ts unchanged (ADEV-179), which is on the oversized-files ratchet.
 */

/**
 * Why an empty queue is empty.
 *
 * `get_agent_queue` requires TWO conditions — assigned to this agent, and Ready
 * — and until AWTD-845 a caller who met only the first got `empty: true` on
 * every poll with nothing naming the one they had missed. Following the
 * published setup exactly produced precisely that: tasks assigned to `claude`,
 * every one of them `statusRole: null`, and a queue that reads like a quiet day.
 *
 * The holds are reported in the order that tells the caller the most. A queue
 * waiting on the CLOCK proves the setup is already correct, so it is named
 * first and never blamed on status — sending someone to change a status that is
 * right is worse than saying nothing.
 */
export function emptyQueueHint(
  mailbox: string,
  notReadyCount: number,
  scheduled: Array<{ startsAt: string }>,
  requireReady: boolean,
  includeUnassigned = false
): string {
  if (scheduled.length > 0) {
    const waiting = `${scheduled.length} task(s) are queued for ${mailbox} but not due to start yet — the earliest begins ${scheduled[0].startsAt}.`
    return notReadyCount > 0
      ? `${waiting} ${notReadyHint(mailbox, notReadyCount, requireReady)}`
      : waiting
  }
  if (notReadyCount > 0) return notReadyHint(mailbox, notReadyCount, requireReady)
  if (includeUnassigned) {
    return `Nothing on this board is Ready for ${mailbox}: no incomplete Ready task is assigned to it, and none is unassigned.`
  }
  return nothingAssignedHint(mailbox)
}

/**
 * The status hold, explained differently depending on which rule produced it.
 *
 * Under the default rule there are now TWO cures, and until AWTD-871 only one was
 * ever offered: "set Ready". For someone who does not use the board that is advice
 * to adopt a feature they have declined, so the second cure is named beside it.
 *
 * A caller who has ALREADY passed `requireReady: false` must not be told to set
 * Ready or to pass the flag they just passed — everything still held is work they
 * deliberately parked, so say that instead.
 */
function notReadyHint(mailbox: string, count: number, requireReady: boolean): string {
  if (!requireReady) {
    return `${count} task(s) are assigned to ${mailbox} but sit in a status the queue never takes — Waiting, Doing, or a project's own state. Those are deliberately parked; move one to Ready, or clear its status, to queue it.`
  }
  return `${count} task(s) are assigned to ${mailbox} but are not in Ready status, so the queue cannot see them. Set Ready from the task's … menu → Status, by dragging the card into the Ready column, or with update_task { statusRole: "ready" }. If you do not use the board at all, ask for the queue with requireReady: false instead and unstatused tasks will queue too.`
}

export function nothingAssignedHint(mailbox: string): string {
  return `No incomplete tasks are assigned to ${mailbox}. A task is queued only when it is BOTH assigned to ${mailbox} and in Ready status.`
}

/** The caller set this polling-only agent to Off, so its queue serves nothing (AWTD-1563). */
export function agentOffHint(mailbox: string): string {
  return `${mailbox} is turned Off in your agent settings, so its queue gives it no work. Turn it back on in Settings → AI Agents to resume.`
}
