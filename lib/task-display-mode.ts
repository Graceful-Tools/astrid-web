/**
 * Task display mode — which task-detail design a user sees (task ffa5bbb5).
 *
 * Two modes, and the difference is where the metadata lives:
 *
 *   list     the checkbox completes the task, and Priority and Assignee get
 *            their own rows in task details, on every surface.
 *   project  task details are compact: tapping the checkbox opens a popover
 *            carrying priority, assignee, board state and complete/reopen
 *            instead of completing the task outright.
 *
 * Jon's report was that the product currently shows a HYBRID of the two, so
 * this is the switch that makes it one or the other per user.
 *
 * NOT THE SAME THING AS lib/project-mode.ts, which is the nearby name and the
 * easy mistake. That module answers "may this user use projects and boards at
 * all" — a build capability plus an admin-granted flag, i.e. access. This
 * answers "which task-detail design do they get" — a preference they set
 * themselves in Appearance. A user can be in project DISPLAY mode without
 * having been granted the projects FEATURE, and the reverse is the common case
 * today, since everyone defaults to list.
 *
 * EVERYONE DEFAULTS TO LIST, existing and new alike: the column default plus
 * the normalizer below, so a null from a row written before the migration and
 * an unset preference resolve the same way. That is deliberate per the task —
 * nobody's task details change appearance until they choose it.
 *
 * Call `normalizeTaskDisplayMode` rather than comparing the string at a call
 * site. Two call sites that spell the comparison differently is exactly the
 * drift documented in docs/CODE_REUSE_AND_CONSISTENCY.md, and here it would
 * show up as one surface compacting while another does not — the very hybrid
 * this setting exists to end.
 */

export const TASK_DISPLAY_MODES = ['list', 'project'] as const

export type TaskDisplayMode = (typeof TASK_DISPLAY_MODES)[number]

/** What a user gets when they have never chosen, or chose something invalid. */
export const DEFAULT_TASK_DISPLAY_MODE: TaskDisplayMode = 'list'

/**
 * Coerce whatever the database or a client sent into a mode.
 *
 * Accepts null/undefined (rows predating the column, clients that omit the
 * field) and unknown strings, and answers `list` for all of them. Reading a
 * preference is not a place to throw: an unrecognised value should render the
 * safe design, not an error page.
 */
export function normalizeTaskDisplayMode(value: unknown): TaskDisplayMode {
  return isTaskDisplayMode(value) ? value : DEFAULT_TASK_DISPLAY_MODE
}

/**
 * Is this exactly one of the modes? Use for WRITE validation, where an unknown
 * value must be rejected rather than silently coerced — a client sending
 * `projectt` should learn it was wrong instead of having it stored as `list`
 * and wondering why the toggle does nothing.
 */
export function isTaskDisplayMode(value: unknown): value is TaskDisplayMode {
  return typeof value === 'string' && (TASK_DISPLAY_MODES as readonly string[]).includes(value)
}

/** Does this mode put priority/assignee/state behind the checkbox popover? */
export function usesCompactTaskDetail(value: unknown): boolean {
  return normalizeTaskDisplayMode(value) === 'project'
}

/**
 * Does tapping the checkbox complete the task?
 *
 * True in list mode. In project mode the checkbox opens the popover instead,
 * and completion moves inside it — which is why this is phrased as a question
 * about the checkbox rather than as `!usesCompactTaskDetail`: the call sites
 * that care are click handlers, and reading `checkboxCompletesTask(mode)` at
 * one is the difference between a correct guard and an inverted one.
 */
export function checkboxCompletesTask(value: unknown): boolean {
  return normalizeTaskDisplayMode(value) === 'list'
}
