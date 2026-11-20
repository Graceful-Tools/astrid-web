"use client"

/**
 * The BOARD STATE row in task details (task 5221e43f).
 *
 * Its own component rather than more JSX inside `TaskFieldEditors`, for the
 * reason iOS keeps `ProjectStateQuickPicker` separate from `TaskDetailViewNew`:
 * the chips, the column derivation and the move planner are one idea, and the
 * field editors are a different one. It also keeps `TaskFieldEditors` from
 * growing, which `tests/rules/oversized-files-ratchet.test.ts` asks for in as
 * many words — take the next piece out rather than raise the number.
 *
 * Renders nothing unless `showsTaskDetailProjectState` says so; that rule is
 * shared with iOS and Mac and is never restated here.
 */
import { LayoutGrid } from "lucide-react"
import { TaskFieldRow } from "./TaskFieldRow"
import { useTranslations } from "@/lib/i18n/client"
import { BoardStatePicker } from "@/components/board-state-picker"
import { useProjectCustomStates } from "@/hooks/useProjectCustomStates"
import {
  applyProjectColumnTo,
  getProjectBoardColumns,
  getTaskProjectColumnId,
} from "@/lib/project-status"
import {
  getProjectIdForTask,
  isTaskInProject,
  projectStateChips,
  showsTaskDetailProjectState,
} from "@/lib/task-detail-project-state"
import type { Task, TaskList } from "@/types/task"

interface TaskDetailBoardStateRowProps {
  task: Task
  availableLists: TaskList[]
  readOnly: boolean
  onUpdate: (task: Task) => void
}

export function TaskDetailBoardStateRow({
  task,
  availableLists,
  readOnly,
  onUpdate,
}: TaskDetailBoardStateRowProps) {
  const { t } = useTranslations()

  // The project comes from the TASK's own memberships, not the selected list:
  // a detail pane opens from search and from labels too, and the board is a
  // fact about the task rather than about where the reader was standing.
  const projectId = getProjectIdForTask(task, availableLists)
  // Shared cached hook, so this row and the board cannot come to disagree
  // about which columns a board has.
  const customStates = useProjectCustomStates(projectId)

  const visible = showsTaskDetailProjectState({
    isInProject: isTaskInProject(task, availableLists),
    isReadOnly: readOnly,
  })

  const columns = getProjectBoardColumns(customStates)
  const currentColumnId = getTaskProjectColumnId(task, columns)

  // After the hooks: a conditional return above them would change the hook
  // order between renders as a task's board membership resolves.
  if (!visible) return null

  // The board's own planner, shared with the task menu, so a state set here,
  // one set there and a card dragged into a column cannot mean different
  // things — including the stale `listType: 'status'` membership it strips.
  // The menu used a second planner that stripped nothing, which is why a
  // status set there looked like it did nothing at all (AWTD-1253).
  const moveTo = (columnId: string) =>
    applyProjectColumnTo(task, columnId, columns, availableLists, onUpdate)

  return (
    <TaskFieldRow label={t('tasks.boardState')} icon={<LayoutGrid className="w-4 h-4" />}>
      <BoardStatePicker
        columns={projectStateChips(columns)}
        selectedColumnId={currentColumnId}
        onSelect={moveTo}
        ariaLabel={t('tasks.boardState')}
        testIdPrefix="task-detail-board-state"
      />
    </TaskFieldRow>
  )
}
