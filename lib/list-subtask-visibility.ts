/**
 * Per-list "show subtasks" visibility.
 *
 * Two independent switches decide whether a parent's subtasks are spliced
 * into a list view:
 *
 *   - `TaskList.showSubtasks` — per-list, set by an owner/admin in list
 *     settings. `null`/`undefined` means the column predates the setting.
 *   - `User.subtaskDisplay` — per-user, 'indented' (show inline) or
 *     'under_parent' (detail view only). See migration
 *     20260702010000_user_subtask_display.
 *
 * The rule, stated once here so iOS/Mac can mirror it verbatim rather than
 * re-deriving it from prose: **a list can opt OUT of showing subtasks, but
 * it cannot opt back IN over a user who has chosen detail-only.** The more
 * restrictive of the two wins, and the user's preference is the one that
 * can't be overridden.
 *
 * `null` must mean SHOW. Every list that existed before the column did reads
 * back as null, and treating that as "hide" would silently empty all of them
 * on the deploy that adds it.
 */

/** What an absent (null/undefined) `showSubtasks` stands in for. */
export const DEFAULT_LIST_SHOW_SUBTASKS = true

/** The user-level preference that suppresses inline subtasks entirely. */
export const SUBTASK_DISPLAY_DETAIL_ONLY = 'under_parent'

/**
 * True when a list view should splice subtasks in under their parents.
 *
 * Unrecognised `subtaskDisplay` values are treated as 'indented' — a client
 * sending a mode this build doesn't know must not blank out every list.
 */
export function shouldShowSubtasksInList(
  listShowSubtasks: boolean | null | undefined,
  userSubtaskDisplay: string | null | undefined,
): boolean {
  if (userSubtaskDisplay === SUBTASK_DISPLAY_DETAIL_ONLY) return false
  return listShowSubtasks ?? DEFAULT_LIST_SHOW_SUBTASKS
}

/**
 * Narrow an inbound API value to a writable `showSubtasks`.
 *
 * Returns `undefined` for anything that isn't a boolean, so a caller PUTing
 * a whole list object that predates the field leaves the stored value alone
 * instead of resetting someone's toggle. Both the v1 and legacy list PUT
 * handlers go through this.
 */
export function normalizeShowSubtasks(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}
