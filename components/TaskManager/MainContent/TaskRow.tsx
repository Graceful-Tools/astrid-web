"use client"

import React from "react"
import { TaskRowContent } from "../../task-row-content"
import type { Task } from "@/types/task"
import type { TaskManagerControllerReturn } from "@/hooks/task-manager/controller-contract"

interface DraggingTaskMetrics {
  taskId: string
  height: number
}

/**
 * The slice of the task-manager controller that a single row needs:
 * selection + drag state plus the per-task action handlers. Bundling these
 * behind the shared contract (Stage 20b) replaces ~14 drilled props with one,
 * and lets TypeScript catch any handler the controller drops.
 */
export type TaskRowControllerSlice = Pick<
  TaskManagerControllerReturn,
  | 'selectedTaskId'
  | 'activeDragTaskId'
  | 'dragTargetTaskId'
  | 'dragTargetPosition'
  | 'manualSortActive'
  | 'manualSortPreviewActive'
  | 'effectiveSession'
  | 'handleTaskClick'
  | 'handleToggleTaskComplete'
  | 'handleCopyTask'
  | 'handleTaskDragStart'
  | 'handleTaskDragHover'
  | 'handleTaskDragLeaveTask'
  | 'handleTaskDragEnd'
>

export interface TaskRowProps {
  task: Task
  /** Indent under the parent row (subtask display mode "indented"). */
  isSubtask?: boolean
  controller: TaskRowControllerSlice
  isMobile: boolean
  isTouchManualSort: boolean
  getPriorityColor: (priority: number) => string
  draggingTaskMetrics: DraggingTaskMetrics | null

  // Per-row DOM registration + measurement cache (shared across the list)
  registerTaskRow: (taskId: string) => (node: HTMLDivElement | null) => void
  taskMeasurementsRef: React.MutableRefObject<Map<string, number>>

  // Shared drop-placeholder renderer
  renderManualPlaceholderRow: (
    key: string,
    label?: string,
    options?: { className?: string; style?: React.CSSProperties }
  ) => React.ReactNode

  // Row-local drag infrastructure owned by MainContent (not the controller)
  setDraggingTaskMetrics: (metrics: DraggingTaskMetrics | null) => void
  startMobileDrag: (taskId: string, touchIdentifier: number) => void
}

/**
 * A single task row in MainContent's list view: the card wrapper plus its
 * drag/drop handlers, the manual-sort drop overlays, the desktop drag tooltip,
 * the TaskRowContent body, and the mobile manual-sort grab handle.
 *
 * Extracted verbatim from MainContent.tsx (Stage 20a). All per-row layout
 * derivation lives here; behavior is unchanged. Stage 20b bundles these props
 * behind a controller contract.
 */
export function TaskRow({
  task,
  controller,
  isMobile,
  isTouchManualSort,
  getPriorityColor,
  draggingTaskMetrics,
  registerTaskRow,
  taskMeasurementsRef,
  renderManualPlaceholderRow,
  setDraggingTaskMetrics,
  startMobileDrag,
  isSubtask,
}: TaskRowProps) {
  const {
    selectedTaskId,
    activeDragTaskId,
    dragTargetTaskId,
    dragTargetPosition,
    manualSortActive,
    manualSortPreviewActive,
    effectiveSession,
    handleTaskClick: onTaskClick,
    handleToggleTaskComplete: onToggleComplete,
    handleCopyTask: onCopyPublic,
    handleTaskDragStart: onDragStart,
    handleTaskDragHover: onDragHover,
    handleTaskDragLeaveTask: onDragLeaveTask,
    handleTaskDragEnd: onDragEnd,
  } = controller
  const currentUserId = effectiveSession?.user?.id
  const isDragging = activeDragTaskId === task.id
  // Unified card styling for both mobile and desktop
  const classNames = [
    'task-row task-card transition-theme relative theme-surface theme-border',
    task.completed
      ? 'task-row-completed theme-bg-hover'
      : selectedTaskId === task.id
        ? 'task-row-selected theme-bg-selected'
        : 'theme-surface-hover'
  ]
  if (isMobile) {
    classNames.push('mobile-task-item')
    if (!isTouchManualSort) {
      classNames.push('cursor-grab')
    }
  } else {
    classNames.push('cursor-grab')
  }

  if (isDragging) {
    classNames.push('opacity-60 ring-2 ring-blue-400/40')
  }

  const rowRef = registerTaskRow(task.id)
  const measuredHeight = taskMeasurementsRef.current.get(task.id) ?? null
  const dropGap = isTouchManualSort ? 0 : 8
  const dropOverlayPosition =
    manualSortPreviewActive && dragTargetTaskId === task.id ? dragTargetPosition : null
  const movingTaskHeight =
    typeof draggingTaskMetrics?.height === 'number'
      ? draggingTaskMetrics.height
      : activeDragTaskId
        ? taskMeasurementsRef.current.get(activeDragTaskId) ?? undefined
        : undefined

  const overlayHeight =
    typeof movingTaskHeight === 'number'
      ? movingTaskHeight
      : measuredHeight ?? undefined

  const overlayTopOffset =
    dropOverlayPosition === 'above'
      ? overlayHeight !== undefined
        ? -(overlayHeight + dropGap)
        : undefined
      : dropOverlayPosition === 'below'
        ? (measuredHeight ?? overlayHeight) !== undefined
          ? (measuredHeight ?? overlayHeight)! + dropGap
          : undefined
        : undefined

  const dropOverlayStyle: React.CSSProperties = {}
  if (overlayHeight !== undefined) {
    dropOverlayStyle.height = `${overlayHeight}px`
  }
  if (overlayTopOffset !== undefined) {
    dropOverlayStyle.top = `${overlayTopOffset}px`
  }

  const shouldRenderDropOverlay =
    dropOverlayPosition === 'above' || dropOverlayPosition === 'below'

  const originPlaceholderStyle: React.CSSProperties = {}
  const originHeight =
    typeof draggingTaskMetrics?.height === 'number' && draggingTaskMetrics.taskId === task.id
      ? draggingTaskMetrics.height
      : measuredHeight ?? undefined
  if (originHeight !== undefined) {
    originPlaceholderStyle.height = `${originHeight}px`
  }

  const rowHeight =
    measuredHeight ??
    (draggingTaskMetrics?.taskId === task.id ? draggingTaskMetrics.height : undefined)
  const mobileGrabberStyle: React.CSSProperties = {
    width: "20%"
  }
  if (rowHeight !== undefined) {
    mobileGrabberStyle.height = `${Math.max(rowHeight / 2, 24)}px`
  }

  return (
    <div key={task.id} className="relative">
      {shouldRenderDropOverlay &&
        renderManualPlaceholderRow(`${task.id}-drop-overlay`, undefined, {
          className: "absolute left-0 right-0 z-20",
          style: dropOverlayStyle
        })}
      {manualSortPreviewActive && isDragging &&
        renderManualPlaceholderRow(`${task.id}-origin-placeholder`, undefined, {
          className: "absolute left-0 right-0 top-0 z-10",
          style: originPlaceholderStyle
        })}
      <div
        ref={rowRef}
        data-task-id={task.id}
        className={classNames.join(' ')}
        onClick={(e) => onTaskClick(task.id, e.currentTarget as HTMLElement)}
        draggable={!isTouchManualSort}
        onDragStart={(event) => {
          if (isTouchManualSort) return
          const rect = event.currentTarget.getBoundingClientRect()
          setDraggingTaskMetrics({ taskId: task.id, height: rect.height })
          taskMeasurementsRef.current.set(task.id, rect.height)
          onDragStart(task.id)
          if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move'
            event.dataTransfer.setData('text/plain', task.id)
          }
        }}
        onDragOver={(event) => {
          if (!manualSortPreviewActive || !activeDragTaskId || activeDragTaskId === task.id) {
            return
          }
          event.preventDefault()
          const rect = event.currentTarget.getBoundingClientRect()
          const offsetY = event.clientY - rect.top
          const ratio = rect.height > 0 ? offsetY / rect.height : 0
          let position: 'above' | 'below' | null = null
          if (ratio <= 0.35) {
            position = 'above'
          } else if (ratio >= 0.65) {
            position = 'below'
          }
          if (!position) {
            return
          }
          onDragHover(task.id, position)
        }}
        onDragLeave={(event) => {
          if (!manualSortPreviewActive) return
          const related = event.relatedTarget as HTMLElement | null
          if (related && event.currentTarget.contains(related)) {
            return
          }
          onDragLeaveTask(task.id)
        }}
        onDrop={(event) => {
          if (manualSortPreviewActive) {
            event.preventDefault()
          }
        }}
        onDragEnd={() => {
          onDragEnd()
          setDraggingTaskMetrics(null)
        }}
        style={{
          // Per-level subtask indent, capped at 4 levels (deeper still shows)
          ...(task.subtaskDepth ? { marginLeft: Math.min(task.subtaskDepth, 4) * 24 } : {}),
          ...(manualSortPreviewActive && isDragging ? { opacity: 0 } : {}),
        }}
      >
        {manualSortPreviewActive && dragTargetTaskId === task.id && !isTouchManualSort && (
          <div className="pointer-events-none absolute -top-12 left-1/2 z-[1600] flex w-max -translate-x-1/2 items-center gap-2 rounded-full border border-blue-400/60 bg-blue-900/95 px-3 py-1.5 text-xs font-medium text-blue-50 shadow-2xl backdrop-blur">
            <span className="inline-flex h-2 w-2 rounded-full bg-emerald-300" />
            <span>Drag to move • Hold Shift to add without removing</span>
          </div>
        )}
        <TaskRowContent
          task={task}
          currentUserId={currentUserId}
          isSelected={selectedTaskId === task.id}
          isMobile={isMobile}
          getPriorityColor={getPriorityColor}
          onToggleComplete={() => onToggleComplete(task.id)}
          onCopyPublic={() => onCopyPublic(task.id)}
        />
        {isTouchManualSort && manualSortActive && (
          <div
            className="absolute bottom-0.5 left-1/2 z-30 flex -translate-x-1/2 items-end justify-center"
            style={mobileGrabberStyle}
            onTouchStart={(event) => {
              const touch = event.touches[0]
              if (!touch || !manualSortActive) {
                return
              }
              const rowNode = event.currentTarget.closest("[data-task-id]") as HTMLDivElement | null
              const rect = rowNode?.getBoundingClientRect()
              const height =
                rect?.height ??
                taskMeasurementsRef.current.get(task.id) ??
                draggingTaskMetrics?.height ??
                undefined
              if (height) {
                setDraggingTaskMetrics({ taskId: task.id, height })
                taskMeasurementsRef.current.set(task.id, height)
              }
              startMobileDrag(task.id, touch.identifier)
              onDragStart(task.id)
              event.stopPropagation()
              event.preventDefault()
            }}
          >
            <div className="mb-0.5 h-[2px] w-10 rounded-full bg-muted-foreground/70" />
          </div>
        )}
      </div>
    </div>
  )
}
