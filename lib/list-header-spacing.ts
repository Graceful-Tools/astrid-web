/**
 * The bottom margin of the 3-column list header — the name, description and
 * view controls — AWTD-1264.
 *
 * In list view the header is followed by "Add a task...", and `mb-6` is the
 * space between them. The board view renders no add-task input there, so the
 * same margin sat directly above the Sort & Filters funnel instead. Stacked
 * with the row's own `mb-4` and the block's `pb-5`, less the half of the 32px
 * funnel that hangs into that padding (ListFilterRow's `-bottom-4`), it put
 * 44px between the description and the funnel. Without it the gap is 20px.
 */
export function listHeaderBottomMarginClass({
  boardMode,
}: {
  /** The list has a project board AND the board surface is showing. */
  boardMode: boolean
}): string {
  return boardMode ? 'mb-0' : 'mb-6'
}
