/**
 * Task Manager Hooks
 *
 * Composable hooks extracted from the monolithic useTaskManagerController.
 * Each hook handles a specific concern:
 *
 * - useTaskSelection: Selection state & keyboard navigation handlers
 * - useTaskDragDrop: Drag and drop state and handlers
 * - useTaskListState: Tasks/lists state management, loading, SSE updates
 * - useTaskNavigation: Mobile/desktop navigation, view state
 * - useTaskPaneState: Task pane positioning, closing animation state
 * - useTaskDetailHydration: fills the opened task's detail-only fields (AWTD-1242)
 */

export { useTaskSelection } from './useTaskSelection'
export type { UseTaskSelectionProps, UseTaskSelectionReturn } from './useTaskSelection'

export { useTaskDragDrop } from './useTaskDragDrop'
export type { UseTaskDragDropProps, UseTaskDragDropReturn } from './useTaskDragDrop'

export { useTaskListState } from './useTaskListState'
export type { UseTaskListStateProps, UseTaskListStateReturn } from './useTaskListState'

export { useTaskNavigation } from './useTaskNavigation'
export type { UseTaskNavigationProps, UseTaskNavigationReturn } from './useTaskNavigation'

export { useTaskPaneState } from './useTaskPaneState'
export type { UseTaskPaneStateProps, UseTaskPaneStateReturn } from './useTaskPaneState'

export { useTaskDetailHydration } from './useTaskDetailHydration'
export type { UseTaskDetailHydrationProps } from './useTaskDetailHydration'
