/**
 * Task display mode — a stored per-user preference (task ffa5bbb5) that WEB NO
 * LONGER ACTS ON (ADEV-56).
 *
 * Two values:
 *
 *   list     the checkbox completes the task, and Priority and Assignee get
 *            their own rows in task details.
 *   project  compact task details, with priority, assignee, board state and
 *            complete behind a popover on the checkbox.
 *
 * Web removed the project layout in ADEV-56. Jon: "remove the 'Project mode'
 * task layout. Now that we open board items in popout it isn't necessary." So
 * web always renders the list layout and Appearance no longer offers the
 * choice. The VALUE stays: iOS, Mac and astrid-core still read and write
 * `taskDisplayMode`, `project` is still valid there, and the API keeps
 * validating it (app/api/v1/users/me/smart-tasks/route.ts). Do not drop the
 * column or narrow `TASK_DISPLAY_MODES` without a coordinated native change.
 *
 * NOT THE SAME THING AS lib/project-mode.ts, which answers "may this user use
 * projects and boards at all" — access, not a layout preference.
 *
 * EVERYONE DEFAULTS TO LIST: the column default plus the normalizer below, so a
 * null from a row written before the migration and an unset preference resolve
 * the same way.
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
