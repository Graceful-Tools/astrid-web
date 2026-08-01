/**
 * Terminal states other than "done" (task 11042ae3).
 *
 * `Task.completed` is a boolean, so there was no way to close something as
 * *not done*. Users expressed "we're not doing this" by deleting the task,
 * which destroyed the title, the discussion, the decision, and any chance of
 * reporting on it.
 *
 * The model is one nullable column rather than a new state machine: closing as
 * canceled still sets `completed = true`, so every existing query, view and
 * filter keeps working. Only the rendering and the reporting differ.
 */

export const CLOSED_REASONS = ['canceled', 'duplicate', 'not_planned'] as const

export type ClosedReason = (typeof CLOSED_REASONS)[number]

export function isClosedReason(value: unknown): value is ClosedReason {
  return typeof value === 'string' && (CLOSED_REASONS as readonly string[]).includes(value)
}

/**
 * Normalize a `closedReason` from an API body.
 *
 * Returns `{ ok: true, value }` where `value` is the reason, or `null` to
 * clear it. Anything unrecognised is an error rather than a silent null: a
 * typo'd reason must not quietly become "completed normally".
 */
export function parseClosedReason(
  input: unknown
): { ok: true; value: ClosedReason | null } | { ok: false; error: string } {
  if (input === undefined || input === null || input === '') {
    return { ok: true, value: null }
  }
  if (!isClosedReason(input)) {
    return { ok: false, error: `closedReason must be one of: ${CLOSED_REASONS.join(', ')}` }
  }
  return { ok: true, value: input }
}

/**
 * Was this task closed as anything other than done?
 *
 * Used for rendering (strikethrough + "Won't do" chip) and to decide whether a
 * repeating series should roll forward.
 */
export function isCanceled(task: { completed?: boolean; closedReason?: string | null }): boolean {
  return Boolean(task.completed) && isClosedReason(task.closedReason)
}

/**
 * GitHub `state_reason` mapping.
 *
 * GitHub models this as `completed` vs `not_planned`. Both "canceled" and
 * "not_planned" map to `not_planned`; a duplicate is also not-planned work as
 * far as GitHub is concerned, since it has no separate duplicate state on the
 * issue itself.
 */
export function toGithubStateReason(closedReason: string | null | undefined): 'completed' | 'not_planned' {
  return isClosedReason(closedReason) ? 'not_planned' : 'completed'
}

/**
 * Inverse of {@link toGithubStateReason} for imports.
 *
 * `not_planned` becomes `canceled` — the most general of our reasons, since
 * GitHub cannot tell us which of the three it was.
 */
export function fromGithubStateReason(stateReason: string | null | undefined): ClosedReason | null {
  return stateReason === 'not_planned' ? 'canceled' : null
}
