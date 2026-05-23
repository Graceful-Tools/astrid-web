import { useCallback, useEffect, useRef, useState, type RefObject } from "react"

interface UseMobileDragSortOptions {
  /** True when this device should use the touch manual-sort path (phone). */
  isTouchManualSort: boolean
  /** True when manual sort is engaged for the current list. */
  manualSortActive: boolean
  /** Currently-dragging task id; clears when the drag ends elsewhere. */
  activeDragTaskId: string | null
  /** Container ref used to detect drags falling below the visible list. */
  taskListContainerRef: RefObject<HTMLElement | null>
  /** Called when the dragged touch lands over a task row. */
  onDragHover: (taskId: string, position: 'above' | 'below') => void
  /** Called when the dragged touch leaves the list below its bottom edge. */
  onDragHoverEnd: () => void
  /** Called on touchend / touchcancel — parent applies the reorder. */
  onDragEnd: () => void
}

interface UseMobileDragSortReturn {
  /** Wire to the per-row drag-handle touchStart. Identifies which touch
   *  to track and which task is being dragged. */
  startMobileDrag: (taskId: string, touchIdentifier: number) => void
}

/**
 * Mobile manual-sort touch state machine for MainContent's task list.
 * Owns the document-level touchmove/touchend/touchcancel listeners and
 * the small state that gates them. Extracted from
 * components/TaskManager/MainContent/MainContent.tsx (Stage 17 of the
 * god-file refactor).
 *
 * Behavior is verbatim from the original:
 *  - Listeners only attach while `mobileDragState && manualSortActive &&
 *    isTouchManualSort` are all true.
 *  - touchmove looks up the hovered task via elementFromPoint, computes
 *    above/below from a 35/65 split, calls onDragHover.
 *  - touchend/touchcancel call onDragEnd and clear local state.
 *  - When activeDragTaskId clears or sort mode flips off, local state
 *    resets — detaching the listeners.
 */
export function useMobileDragSort(opts: UseMobileDragSortOptions): UseMobileDragSortReturn {
  const {
    isTouchManualSort,
    manualSortActive,
    activeDragTaskId,
    taskListContainerRef,
    onDragHover,
    onDragHoverEnd,
    onDragEnd,
  } = opts

  const [mobileDragState, setMobileDragState] = useState<{ taskId: string } | null>(null)
  const mobileDragTouchIdRef = useRef<number | null>(null)

  const startMobileDrag = useCallback((taskId: string, touchIdentifier: number) => {
    mobileDragTouchIdRef.current = touchIdentifier
    setMobileDragState({ taskId })
  }, [])

  // Reset when the parent's drag-active flag clears.
  useEffect(() => {
    if (!activeDragTaskId) {
      setMobileDragState(null)
      mobileDragTouchIdRef.current = null
    }
  }, [activeDragTaskId])

  // Reset when sort mode flips off.
  useEffect(() => {
    if ((!manualSortActive || !isTouchManualSort) && mobileDragState) {
      setMobileDragState(null)
      mobileDragTouchIdRef.current = null
    }
  }, [manualSortActive, isTouchManualSort, mobileDragState])

  // Document-level touch listeners. Only attached while a drag is in
  // progress and the manual-sort touch path is engaged.
  useEffect(() => {
    if (!isTouchManualSort || !manualSortActive || !mobileDragState) {
      return
    }

    const findTrackedTouch = (touches: TouchList): Touch | null => {
      if (mobileDragTouchIdRef.current === null) {
        return touches.length > 0 ? touches[0] : null
      }
      for (let i = 0; i < touches.length; i += 1) {
        const current = touches.item(i)
        if (current && current.identifier === mobileDragTouchIdRef.current) {
          return current
        }
      }
      return null
    }

    const handleTouchMove = (event: TouchEvent) => {
      const touch = findTrackedTouch(event.touches)
      if (!touch) {
        return
      }
      event.preventDefault()

      const targetElement = document.elementFromPoint(touch.clientX, touch.clientY) as HTMLElement | null
      if (targetElement) {
        const taskElement = targetElement.closest<HTMLElement>("[data-task-id]")
        if (taskElement) {
          const hoveredTaskId = taskElement.getAttribute("data-task-id")
          if (!hoveredTaskId || hoveredTaskId === activeDragTaskId) {
            return
          }
          const rect = taskElement.getBoundingClientRect()
          const offsetY = touch.clientY - rect.top
          const ratio = rect.height > 0 ? offsetY / rect.height : 0
          let position: 'above' | 'below' | null = null
          if (ratio <= 0.35) {
            position = 'above'
          } else if (ratio >= 0.65) {
            position = 'below'
          }
          if (position) {
            onDragHover(hoveredTaskId, position)
          }
          return
        }
      }

      const listContainer = taskListContainerRef.current
      if (listContainer) {
        const listRect = listContainer.getBoundingClientRect()
        if (touch.clientY > listRect.bottom) {
          onDragHoverEnd()
        }
      }
    }

    const handleTouchEnd = (event: TouchEvent) => {
      const touch = findTrackedTouch(event.changedTouches)
      if (!touch) {
        return
      }
      event.preventDefault()
      setMobileDragState(null)
      mobileDragTouchIdRef.current = null
      onDragEnd()
    }

    document.addEventListener("touchmove", handleTouchMove, { passive: false })
    document.addEventListener("touchend", handleTouchEnd, { passive: false })
    document.addEventListener("touchcancel", handleTouchEnd, { passive: false })

    return () => {
      document.removeEventListener("touchmove", handleTouchMove)
      document.removeEventListener("touchend", handleTouchEnd)
      document.removeEventListener("touchcancel", handleTouchEnd)
    }
  }, [
    isTouchManualSort,
    manualSortActive,
    mobileDragState,
    activeDragTaskId,
    taskListContainerRef,
    onDragHover,
    onDragHoverEnd,
    onDragEnd,
  ])

  return { startMobileDrag }
}
