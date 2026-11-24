/**
 * Is there anything for the scheduled loop to do? Decided here, where it can
 * be tested; `astrid-agent queue` and astrid-web's
 * `scripts/agent-queue-status.ts` only fetch and print. (Moved from
 * astrid-web's scripts/lib/agent-queue-verdict.ts in AWTD-1691, which now
 * re-exports this file.)
 *
 * WHY THE VERDICT IS MORE THAN `empty`. The endpoint's `empty` flag describes
 * the Ready queue and nothing else. The run is also required to act on
 * `attention` — comments and list-chat replies nobody has answered (AWTD-963).
 * On 2026-09-20 the loop skipped past two direct questions from Jon, "nothing
 * queued", because it only ever read `empty`.
 *
 * (It also used to wake on the client-side lane sweep's RECHECK/REVIEW items.
 * The server settles Waiting now — astrid-core's waiting rules — so a task that
 * wakes simply arrives in the queue.)
 *
 * WHY WAKING IS BOUNDED. "Token efficient" means a quiet tick is free AND a
 * noisy one is bounded. An inbox item the agent decides not to answer — the
 * "thanks" — would otherwise wake a session every half hour until the heat
 * death of the subscription. So each wake-able thing has a key (the comment or
 * message id), the loop records the
 * keys it has run for, and a key wakes at most one run. A NEW comment is a new
 * key and wakes another. The queue itself is exempt: a Ready task is work
 * until someone moves it, and the claim protocol already bounds that.
 */

export interface QueueSnapshotTask {
  id: string
  identifier?: string | null
  title?: string
  /** Carries the LONG-RUN flag (AWTD-1041, scripts/lib/long-run.ts). */
  description?: string | null
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

/**
 * Inbox notes waiting on an agent to clarify them (ADEV-227). The server
 * leaves out a note already carrying an open agent question, so a tick does
 * not loop on it.
 */
export interface InboxSnapshot {
  ideas: Array<{ id: string; identifier?: string | null; title?: string; updatedAt?: string }>
  truncated?: boolean
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
  /** Present only under `includeUnassigned` on a named board, on a server with ADEV-227. */
  inbox?: InboxSnapshot | null
  hint?: string
}

export type QueueVerdictReason = 'queue' | 'inbox' | 'ideas' | 'idle'

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
export function wakeKeys(snapshot: QueueSnapshot): string[] {
  const keys: string[] = []
  for (const task of snapshot.attention?.tasks ?? []) {
    keys.push(`comment:${task.id}:${task.lastComment.id}`)
  }
  for (const message of snapshot.attention?.messages ?? []) {
    keys.push(`message:${message.id}`)
  }
  for (const idea of snapshot.inbox?.ideas ?? []) keys.push(ideaKey(idea))
  return keys
}

/** An idea's key carries its last edit, so an edited note wakes another run and an unchanged one does not. */
function ideaKey(idea: { id: string; updatedAt?: string }): string {
  return `idea:${idea.id}:${idea.updatedAt ?? ''}`
}

function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralForm}`
}

function label(task: { id: string; identifier?: string | null }): string {
  return task.identifier ?? task.id
}

export function decideQueueVerdict({
  snapshot,
  seen,
}: {
  snapshot: QueueSnapshot
  seen: ReadonlySet<string>
}): QueueVerdict {
  const keys = wakeKeys(snapshot)

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

  // 3. Inbox ideas to clarify (ADEV-227) — each wakes one run, like a comment.
  const newIdeas = (snapshot.inbox?.ideas ?? []).filter(idea => !seen.has(ideaKey(idea)))
  if (newIdeas.length > 0) {
    return {
      work: true,
      reason: 'ideas',
      line: `QUEUE: empty — ${plural(newIdeas.length, 'unclarified Inbox idea')} (${newIdeas.map(label).join(', ')})`,
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
  const muted = (attention?.tasks.length ?? 0) + (attention?.messages.length ?? 0) +
    (snapshot.inbox?.ideas.length ?? 0)
  if (muted > 0) {
    notes.push(`${plural(muted, 'unanswered item')} already woke a run; a new comment wakes another`)
  }
  if (!attention) notes.push('inbox not read')
  if (notes.length > 0) line += ` [${notes.join('; ')}]`

  return { work: false, reason: 'idle', line, keys }
}
