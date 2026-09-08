import { useMemo } from "react"
import { normalizeTaskDisplayMode } from "@/lib/task-display-mode"
import type { Task } from "@/types/task"
import type { TaskRowControllerSlice } from "@/components/TaskManager/MainContent/TaskRow"

/**
 * The row-facing slice of the task-manager controller, built once per change
 * rather than once per render (task ed1d85ba).
 *
 * MainContent used to assemble this as a bare object literal, so every row got
 * a new `controller` on every render and no memo boundary below it could ever
 * hold. `quickTaskInput` lives in useTaskManagerModals, above MainContent, so
 * "every render" includes every character typed into the add-task box: at the
 * virtualization threshold that was 150 full row renders per keystroke, and
 * virtualization is off entirely in manual-sort mode.
 *
 * Inputs are taken loosely because that is how they arrive at MainContent —
 * declared with a void return and a bare string several props up the chain.
 * Normalising here means a display mode that travelled down that chain still
 * cannot reach a row as an unrecognised value (task ffa5bbb5).
 */
export interface TaskRowControllerInput {
  selectedTaskId: string
  activeDragTaskId: string | null
  dragTargetTaskId: string | null
  dragTargetPosition: 'above' | 'below' | 'end' | null
  manualSortActive: boolean
  manualSortPreviewActive: boolean
  effectiveSession: any
  handleTaskClick: (taskId: string, taskElement?: HTMLElement) => Promise<void> | void
  handleToggleTaskComplete: (taskId: string) => Promise<void> | void
  handleCopyTask: (taskId: string, targetListId?: string, includeComments?: boolean) => Promise<void> | void
  handleTaskDragStart: (taskId: string) => void
  handleTaskDragHover: (taskId: string, position: 'above' | 'below') => void
  handleTaskDragLeaveTask: (taskId: string) => void
  handleTaskDragEnd: () => void
  handleUpdateTask: (task: Task) => Promise<void> | void
  taskDisplayMode: unknown
}

export function useTaskRowController({
  selectedTaskId,
  activeDragTaskId,
  dragTargetTaskId,
  dragTargetPosition,
  manualSortActive,
  manualSortPreviewActive,
  effectiveSession,
  handleTaskClick,
  handleToggleTaskComplete,
  handleCopyTask,
  handleTaskDragStart,
  handleTaskDragHover,
  handleTaskDragLeaveTask,
  handleTaskDragEnd,
  handleUpdateTask,
  taskDisplayMode,
}: TaskRowControllerInput): TaskRowControllerSlice {
  return useMemo(() => ({
    selectedTaskId,
    activeDragTaskId,
    dragTargetTaskId,
    dragTargetPosition,
    manualSortActive,
    manualSortPreviewActive,
    effectiveSession,
    handleTaskClick,
    handleToggleTaskComplete,
    handleCopyTask,
    handleTaskDragStart,
    handleTaskDragHover,
    handleTaskDragLeaveTask,
    handleTaskDragEnd,
    // Adapted rather than cast: the props these arrive on are declared more
    // loosely than the controller's own types.
    handleUpdateTask: async (updated: Task) => {
      await handleUpdateTask(updated)
    },
    taskDisplayMode: normalizeTaskDisplayMode(taskDisplayMode),
  }) as TaskRowControllerSlice, [
    selectedTaskId,
    activeDragTaskId,
    dragTargetTaskId,
    dragTargetPosition,
    manualSortActive,
    manualSortPreviewActive,
    effectiveSession,
    handleTaskClick,
    handleToggleTaskComplete,
    handleCopyTask,
    handleTaskDragStart,
    handleTaskDragHover,
    handleTaskDragLeaveTask,
    handleTaskDragEnd,
    handleUpdateTask,
    taskDisplayMode,
  ])
}
