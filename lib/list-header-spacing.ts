/**
 * The bottom margin of the 3-column list header — the name, description and
 * view controls — AWTD-1264.
 *
 * In list view the header is followed by "Add a task...", and `mb-6` is the
 * space between them. The board view renders no add-task input, so the same
 * margin would stack with the row's own `mb-4` and the block's `pb-5` into a
 * large empty gap above the board. Hence `mb-0` there.
 *
 * This used to be measured against the Sort & Filters funnel, which hung into
 * that padding from the divider line below the header. AWTD-1356 moved the
 * funnel up beside the gear, so nothing sits in that space any more — but the
 * board/list distinction above still holds on its own.
 */
export function listHeaderBottomMarginClass({
  boardMode,
}: {
  /** The list has a project board AND the board surface is showing. */
  boardMode: boolean
}): string {
  return boardMode ? 'mb-0' : 'mb-6'
}
