import { useMemo } from "react"
import { getBoardRowContext, getProjectIdForBoard } from "@/lib/project-status"
import { useProjectCustomStates } from "@/hooks/useProjectCustomStates"
import type { TaskList } from "@/types/task"

/**
 * The board behind the selected list, or null. Built once for the whole list
 * rather than per row: every row offers the same columns, and a row that
 * resolved its current column against a different project than its buttons
 * came from would render a picker with nothing selected (task 036ef139).
 *
 * The project id is resolved first because the custom states are FETCHED by
 * it, and the row picker has to read them the same way the board does — a
 * picker built without them offers only the legacy row-backed customs, and
 * once the rows are dropped, none at all (task 9ddf4a6f).
 *
 * Moved out of MainContent (AWTD-1025) so that file does not grow.
 */
export function useBoardRowContext(lists: TaskList[], selectedListId: string) {
  const boardProjectId = useMemo(
    () => getProjectIdForBoard(lists, selectedListId),
    [lists, selectedListId],
  )
  const boardCustomStates = useProjectCustomStates(boardProjectId)
  return useMemo(
    () => getBoardRowContext(lists, selectedListId, boardCustomStates),
    [lists, selectedListId, boardCustomStates],
  )
}
