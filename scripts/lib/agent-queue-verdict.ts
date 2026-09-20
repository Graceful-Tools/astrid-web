/**
 * Is there anything for the scheduled loop to do? Decided here, where it can
 * be tested; `scripts/agent-queue-status.ts` only fetches and prints.
 *
 * WHY THE VERDICT IS MORE THAN `empty`. The endpoint's `empty` flag describes
 * the Ready queue and nothing else. The run is required to act on two other
 * things that arrive on the same call or from the sweep:
 *
 *   - `attention` — comments and list-chat replies nobody has answered
 *     (AWTD-963). On 2026-09-20 the loop skipped past two direct questions
 *     from Jon, "nothing queued", because it only ever read `empty`.
 *   - the Waiting lanes — a date-parked task comes back to Ready only when
 *     `scripts/ready-tasks.ts` sweeps, and until now the sweep ran only inside
 *     a session that the queue had to be non-empty to start. RECHECK and
 *     REVIEW items are the agent's work by definition (docs/FIXALL_WORKFLOW.md).
 *
 * WHY WAKING IS BOUNDED. "Token efficient" means a quiet tick is free AND a
 * noisy one is bounded. An inbox item the agent decides not to answer — the
 * sweep's own parking comment, a "thanks" — would otherwise wake a session
 * every half hour until the heat death of the subscription. So each wake-able
 * thing has a key (the comment id, the lane watermark), the loop records the
 * keys it has run for, and a key wakes at most one run. A NEW comment is a new
 * key and wakes another. The queue itself is exempt: a Ready task is work
 * until someone moves it, and the claim protocol already bounds that.
 */

export interface QueueSnapshotTask {
  id: string
  identifier?: string | null
  title?: string
}

export interface AttentionSnapshot {
  tasks: Array<{
    id: string
    identifier?: string | null
    title?: string
    lastComment: { id: string; excerpt?: string }
  }>
  messages: Array<{ id: string; content?: string }>
  truncated?: boolean
  skipped?: string[]
}

/** The subset of `GET /api/v1/agent-queue` the verdict reads. */
export interface QueueSnapshot {
  empty: boolean
  queue: QueueSnapshotTask[]
  held?: {
    notDueCount?: number
    notReadyCount?: number
    scheduled?: Array<{ id: string; title: string; startsAt: string }>
  }
  /** Absent on a response that predates AWTD-963, or when the token could not read it. */
  attention?: AttentionSnapshot | null
  hint?: string
}

export interface LaneItem {
  id: string
  action: 'recheck' | 'review'
  commentWatermark: string | null
}

/** The sweep's RECHECK/REVIEW entries, or null when the sweep could not be read. */
export type LaneSnapshot = LaneItem[] | null

export type QueueVerdictReason = 'queue' | 'inbox' | 'lanes' | 'idle'

export interface QueueVerdict {
  /** Start a session? */
  work: boolean
  reason: QueueVerdictReason
  /** The one `QUEUE:` line the loop's log keeps. */
  line: string
  /**
   * Every wake-able key present right now — what the caller records as seen
   * once this tick is decided. It is the CURRENT set, not an accumulation, so
   * an answered comment drops out and the file prunes itself.
   */
  keys: string[]
}

/** Each thing that may wake a run, as a stable key. Order is deterministic for the file. */
export function wakeKeys(snapshot: QueueSnapshot, lanes: LaneSnapshot): string[] {
  const keys: string[] = []
  for (const task of snapshot.attention?.tasks ?? []) {
    keys.push(`comment:${task.id}:${task.lastComment.id}`)
  }
  for (const message of snapshot.attention?.messages ?? []) {
    keys.push(`message:${message.id}`)
  }
  for (const item of lanes ?? []) {
    keys.push(`${item.action}:${item.id}:${item.commentWatermark ?? 'none'}`)
  }
  return keys
}

function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralForm}`
}

function label(task: { id: string; identifier?: string | null }): string {
  return task.identifier ?? task.id
}

export function decideQueueVerdict({
  snapshot,
  lanes,
  seen,
}: {
  snapshot: QueueSnapshot
  lanes: LaneSnapshot
  seen: ReadonlySet<string>
}): QueueVerdict {
  const keys = wakeKeys(snapshot, lanes)

  // 1. The queue. Never deduplicated: a Ready task is work until it moves.
  if (snapshot.queue.length > 0) {
    return {
      work: true,
      reason: 'queue',
      line: `QUEUE: ${plural(snapshot.queue.length, 'task')} ready`,
      keys,
    }
  }

  // 2. The inbox — only what this loop has not already run for.
  const attention = snapshot.attention
  const newComments = (attention?.tasks ?? []).filter(
    task => !seen.has(`comment:${task.id}:${task.lastComment.id}`),
  )
  const newMessages = (attention?.messages ?? []).filter(
    message => !seen.has(`message:${message.id}`),
  )
  if (newComments.length > 0 || newMessages.length > 0) {
    const parts: string[] = []
    if (newComments.length > 0) {
      parts.push(
        `${plural(newComments.length, 'unanswered comment')} (${newComments.map(label).join(', ')})`,
      )
    }
    if (newMessages.length > 0) {
      parts.push(plural(newMessages.length, 'unanswered list-chat message'))
    }
    return { work: true, reason: 'inbox', line: `QUEUE: empty — ${parts.join('; ')}`, keys }
  }

  // 3. The lanes — same rule. A bumped recheck date is a new watermark, so it wakes again.
  const newLanes = (lanes ?? []).filter(
    item => !seen.has(`${item.action}:${item.id}:${item.commentWatermark ?? 'none'}`),
  )
  if (newLanes.length > 0) {
    const recheck = newLanes.filter(item => item.action === 'recheck').length
    const review = newLanes.filter(item => item.action === 'review').length
    return {
      work: true,
      reason: 'lanes',
      line: `QUEUE: empty — RECHECK ${recheck} / REVIEW ${review} need the agent`,
      keys,
    }
  }

  // 4. Idle. Say why, the way the log already reads, and name what was NOT
  // read: an unread inbox and a quiet one are different facts.
  const next = snapshot.held?.scheduled?.[0]
  let line = next
    ? `QUEUE: empty — next task ("${next.title}") comes due ${next.startsAt}`
    : `QUEUE: empty${snapshot.hint ? ` — ${snapshot.hint}` : ''}`

  const notes: string[] = []
  const muted = (attention?.tasks.length ?? 0) + (attention?.messages.length ?? 0) + (lanes?.length ?? 0)
  if (muted > 0) {
    notes.push(`${plural(muted, 'unanswered item')} already woke a run; a new comment wakes another`)
  }
  if (!attention) notes.push('inbox not read')
  if (lanes === null) notes.push('lanes not read')
  if (notes.length > 0) line += ` [${notes.join('; ')}]`

  return { work: false, reason: 'idle', line, keys }
}
