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
import { useProjectCustomStates } from "@/hooks/useProjectCustomStates"
import {
  getProjectBoardColumns,
  getTaskProjectColumnId,
  resolveProjectColumnMove,
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
  /** 'list' | 'project'; absent means list. */
  displayMode?: string | null
  readOnly: boolean
  onUpdate: (task: Task) => void
}

export function TaskDetailBoardStateRow({
  task,
  availableLists,
  displayMode,
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
    displayMode,
    isInProject: isTaskInProject(task, availableLists),
    isReadOnly: readOnly,
  })

  const columns = getProjectBoardColumns(customStates)
  const currentColumnId = getTaskProjectColumnId(task, columns)

  // After the hooks: a conditional return above them would change the hook
  // order between renders as a task's board membership resolves.
  if (!visible) return null

  const moveTo = (columnId: string) => {
    const column = columns.find(candidate => candidate.id === columnId)
    if (!column) return
    // The board's own planner, so a state set here and a card dragged into a
    // column cannot mean different things — including the stale `listType:
    // 'status'` membership it strips.
    const move = resolveProjectColumnMove(task, column, availableLists)
    const listById = new Map(availableLists.map(entry => [entry.id, entry]))
    const nextLists = move.listIds
      .map(listId => listById.get(listId))
      .filter((entry): entry is TaskList => Boolean(entry))
    onUpdate({ ...task, completed: move.completed, lists: nextLists, statusRole: move.statusRole } as Task)
  }

  return (
    <TaskFieldRow label={t('tasks.boardState')} icon={<LayoutGrid className="w-4 h-4" />}>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('tasks.boardState')}>
        {projectStateChips(columns).map(column => {
          const isSelected = currentColumnId === column.id
          return (
            <button
              key={column.id}
              type="button"
              data-testid={`task-detail-board-state-${column.id}`}
              onClick={() => moveTo(column.id)}
              aria-pressed={isSelected}
              title={column.description || undefined}
              className={`h-8 px-3 rounded-lg text-sm font-medium transition-all duration-150 active:scale-95 ${
                isSelected
                  ? 'bg-blue-500 text-white'
                  : 'bg-transparent border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200'
              }`}
            >
              {column.name}
            </button>
          )
        })}
      </div>
    </TaskFieldRow>
  )
}
