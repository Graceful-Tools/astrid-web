/**
 * The drag a sidebar list carries onto a project board (AWTD-1660). Its own
 * tiny module because the sidebar is first-load JS and the board is not: the
 * sidebar imports only this, never lib/project-board-rows.
 */

/** The drag type a sidebar list carries; a task card carries text/plain. */
export const PROJECT_BOARD_LIST_DRAG_TYPE = 'application/x-astrid-list-id'

/** The list id a drag carries, or null when it is not a list (a task card, a file). */
export function readDraggedListId(dataTransfer: Pick<DataTransfer, 'getData'> & { types: ReadonlyArray<string> }): string | null {
  if (!Array.from(dataTransfer.types).includes(PROJECT_BOARD_LIST_DRAG_TYPE)) return null
  return dataTransfer.getData(PROJECT_BOARD_LIST_DRAG_TYPE) || null
}
