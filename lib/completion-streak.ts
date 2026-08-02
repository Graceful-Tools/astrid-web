/**
 * Completion-streak folding (task 59e2dcff).
 *
 * A repeating task accumulates one system comment per completion. After a few
 * weeks the thread is nothing but "Jon Paris marked this as complete" over and
 * over, and any real discussion is buried. This folds a run of them into a
 * single expandable row.
 *
 * Mirrors the Swift `CompletionStreak` helper (iOS/Mac task dd3fda86) so a
 * repeating task does not read differently on three clients.
 *
 * The rules, and why each one:
 *
 * - **Only system comments** (`authorId === null`). A comment a person wrote is
 *   never folded, whatever it says.
 * - **Only completion events.** Identified by `systemEventType === 'COMPLETED'`
 *   where present, falling back to the English marker for comments written
 *   before that column existed. The typed field is the point: the fold used to
 *   depend entirely on prose, so localising one sentence would have broken it
 *   on every client simultaneously.
 * - **Runs of 3 or more only.** Folding two lines into "completed 2 times"
 *   hides as much as it saves.
 * - **A user comment splits a run.** Someone replying mid-streak is a real
 *   boundary in the conversation, and folding across it would reorder the
 *   thread's meaning.
 */

/** Legacy marker, retained only for comments predating `systemEventType`. */
const LEGACY_COMPLETION_MARKER = 'marked this as complete'
const LEGACY_REOPEN_MARKER = 'marked this as incomplete'

/** Shortest run worth collapsing. */
export const MIN_STREAK_LENGTH = 3

export interface StreakComment {
  id: string
  content: string
  authorId?: string | null
  systemEventType?: string | null
  createdAt: Date | string
}

export type StreakEntry<T extends StreakComment> =
  | { kind: 'comment'; comment: T }
  | { kind: 'streak'; comments: T[]; count: number; from: Date; to: Date }

/** Is this a system-authored comment (as opposed to one a person wrote)? */
export function isSystemComment(comment: StreakComment): boolean {
  return comment.authorId === null || comment.authorId === undefined
}

/**
 * Is this a completion event?
 *
 * Prefers the typed discriminator and falls back to the English marker only
 * when the column is null — i.e. for rows written before it existed. New
 * comments never take the fallback path.
 */
export function isCompletionComment(comment: StreakComment): boolean {
  if (!isSystemComment(comment)) return false

  if (comment.systemEventType) {
    return comment.systemEventType === 'COMPLETED'
  }

  const content = comment.content || ''
  // "incomplete" contains "complete", so the reopen marker must be excluded
  // explicitly or every reopen would count as a completion.
  if (content.includes(LEGACY_REOPEN_MARKER)) return false
  return content.includes(LEGACY_COMPLETION_MARKER)
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}

/**
 * Fold consecutive completion comments into streak entries.
 *
 * Input order is preserved — this never reorders the thread, it only groups
 * adjacent items. Runs shorter than {@link MIN_STREAK_LENGTH} are emitted as
 * ordinary comments, unchanged.
 */
export function foldCompletionStreaks<T extends StreakComment>(comments: T[]): StreakEntry<T>[] {
  const entries: StreakEntry<T>[] = []
  let run: T[] = []

  const flush = () => {
    if (run.length === 0) return

    if (run.length >= MIN_STREAK_LENGTH) {
      const dates = run.map(comment => toDate(comment.createdAt)).sort((a, b) => a.getTime() - b.getTime())
      entries.push({
        kind: 'streak',
        comments: run,
        count: run.length,
        from: dates[0],
        to: dates[dates.length - 1],
      })
    } else {
      // Too short to be worth hiding — emit each one normally.
      for (const comment of run) entries.push({ kind: 'comment', comment })
    }
    run = []
  }

  for (const comment of comments) {
    if (isCompletionComment(comment)) {
      run.push(comment)
    } else {
      // Any non-completion comment — user or system — ends the run.
      flush()
      entries.push({ kind: 'comment', comment })
    }
  }
  flush()

  return entries
}

/**
 * Label for a folded run: "Completed 7 times" plus the span it covers.
 *
 * Kept here rather than in the component so the wording can be asserted, and
 * so iOS/Mac have one place to mirror.
 */
export function describeStreak(count: number, from: Date, to: Date): string {
  const sameDay = from.toDateString() === to.toDateString()
  const format = (date: Date) =>
    date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

  return sameDay
    ? `Completed ${count} times on ${format(from)}`
    : `Completed ${count} times · ${format(from)} – ${format(to)}`
}
