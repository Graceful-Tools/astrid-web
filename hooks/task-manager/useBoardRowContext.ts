import { useMemo } from "react"
import { getBoardRowContext, getProjectIdForBoard } from "@/lib/project-status"
import { useProjectCustomStates } from "@/hooks/useProjectCustomStates"
import { useLoadedProjects } from "@/hooks/use-loaded-projects"
import type { BoardStatusSource } from "@/lib/task-board-status"
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
 *
 * Also returns what each row's board-status pill reads (AWTD-1582): the synced
 * lists (their `projectId` says which board a list is on, including for a
 * member who is not a project member), the reader's projects (renamed and
 * custom column names) and this board, whose column names win.
 */
export function useBoardRowContext(lists: TaskList[], selectedListId: string) {
  const boardProjectId = useMemo(
    () => getProjectIdForBoard(lists, selectedListId),
    [lists, selectedListId],
  )
  const boardCustomStates = useProjectCustomStates(boardProjectId)
  const projects = useLoadedProjects()
  const board = useMemo(
    () => getBoardRowContext(lists, selectedListId, boardCustomStates),
    [lists, selectedListId, boardCustomStates],
  )
  const statusSource = useMemo<BoardStatusSource>(
    () => ({ lists, projects, board }),
    [lists, projects, board],
  )
  return { board, statusSource }
}
