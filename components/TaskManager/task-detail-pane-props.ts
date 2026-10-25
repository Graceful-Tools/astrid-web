/**
 * The props both task-detail panes share (AWTD-1227).
 *
 * There are two render sites in `TaskManagerView` — the desktop slide-out and
 * the mobile full screen — and they differ in four props: how they close,
 * whether they can expand, the anchor element, and swipe-to-dismiss. The other
 * dozen were written out twice.
 *
 * That duplication is not cosmetic. Adding the subtasks props to the desktop
 * site and not the mobile one left the mobile pane quietly without subtasks,
 * and the two blocks look identical enough in review that nobody would catch
 * it. Stating them once makes the next feature reach both by construction.
 *
 * Out of the component for the ratchet's stated reason: `TaskManagerView` is
 * budgeted in `tests/rules/oversized-files-ratchet.test.ts`, and the way to add
 * to it is to take something out.
 */

import { canUserEditTask } from '@/lib/list-permissions'
import { isCollaborativePublicTask } from '@/lib/public-list-utils'
import type { Task, TaskList, User } from '@/types/task'

export interface TaskDetailPaneDeps {
  task: Task
  lists: TaskList[]
  selectedListId: string | null
  /** EVERY task, subtasks included — see `subtasks` below. */
  tasks: Task[]
  /** The filtered, top-level rows: what the pickers inside the pane offer. */
  finalFilteredTasks: Task[]
  user: User
  displayMode: string | null
  handleUpdateTask: (task: Task) => void | Promise<void>
  handleLocalUpdateTask: unknown
  handleDeleteTask: (taskId: string) => void | Promise<void>
  handleCopyTask: (taskId: string, targetListId?: string, includeComments?: boolean) => Promise<void>
  handleToggleTaskComplete: (taskId: string) => Promise<void>
  handleCreateTask: (
    title: string,
    options?: { parentTaskId?: string | null },
  ) => Promise<string | null>
}

export function taskDetailPaneProps(deps: TaskDetailPaneDeps) {
  const { task, lists, selectedListId, tasks, finalFilteredTasks, user } = deps
  const taskList = task.lists?.[0] || lists.find(list => list.id === selectedListId)
  const canEdit = taskList ? canUserEditTask(user, task, taskList) : true

  return {
    displayMode: deps.displayMode,
    task,
    currentUser: user,
    availableLists: lists,
    availableTasks: finalFilteredTasks,
    // Children come from the UNFILTERED set. `finalFilteredTasks` excludes
    // subtasks by design — the controller strips them so they never render as
    // top-level rows — so deriving children from it would always find none.
    subtasks: tasks.filter(candidate => candidate.parentTaskId === task.id),
    // The list row's own completion handler, so the pane has no second path.
    onToggleSubtaskComplete: deps.handleToggleTaskComplete,
    onAddSubtask: async (parentTaskId: string, title: string) => {
      await deps.handleCreateTask(title, { parentTaskId })
    },
    onUpdate: deps.handleUpdateTask,
    onLocalUpdate: deps.handleLocalUpdateTask as (
      updatedTaskOrFn: Task | ((taskId: string, currentTask: Task) => Task),
    ) => void,
    onDelete: deps.handleDeleteTask,
    onCopy: deps.handleCopyTask,
    readOnly: !canEdit,
    canComment: canEdit || isCollaborativePublicTask(task),
  }
}
