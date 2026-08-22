import { useCallback, useEffect, useRef, useState, type RefObject } from "react"
import { PROMOTE_DROP_TARGET_ID } from "@/lib/subtask-promotion"

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
  /**
   * Called when the finger moves onto or off the "move out of subtask" strip.
   *
   * REPORTING ONLY. The pending reorder target is MainContent's state, not
   * this hook's, so clearing it on arrival is the parent's call — it already
   * has handleTaskDragLeaveTask for that. Deciding here would mean guessing at
   * a target the hook cannot see.
   */
  onPromoteHover?: (isOver: boolean) => void
  /**
   * Called on touchend while over that strip, before onDragEnd.
   *
   * Optional so a caller that has not wired promotion yet keeps today's
   * behaviour (the drop simply ends the drag) instead of throwing mid-gesture.
   */
  onDropOnPromoteTarget?: () => void
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
    onPromoteHover,
    onDropOnPromoteTarget,
  } = opts

  const [mobileDragState, setMobileDragState] = useState<{ taskId: string } | null>(null)
  const mobileDragTouchIdRef = useRef<number | null>(null)
  /** Whether the finger is currently over the promote strip. */
  const overPromoteTargetRef = useRef(false)

  const startMobileDrag = useCallback((taskId: string, touchIdentifier: number) => {
    mobileDragTouchIdRef.current = touchIdentifier
    setMobileDragState({ taskId })
  }, [])

  // Reset when the parent's drag-active flag clears.
  useEffect(() => {
    if (!activeDragTaskId) {
      setMobileDragState(null)
      mobileDragTouchIdRef.current = null
      overPromoteTargetRef.current = false
    }
  }, [activeDragTaskId])

  // Reset when sort mode flips off.
  useEffect(() => {
    if ((!manualSortActive || !isTouchManualSort) && mobileDragState) {
      setMobileDragState(null)
      mobileDragTouchIdRef.current = null
      overPromoteTargetRef.current = false
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

      // The promote strip is checked FIRST and returns early. It sits inside
      // the list, so a finger over it is not over a row, and treating it as a
      // reorder hover would arm a move the user did not ask for.
      const overPromoteTarget = Boolean(
        targetElement?.closest(`#${PROMOTE_DROP_TARGET_ID}`),
      )
      if (overPromoteTarget !== overPromoteTargetRef.current) {
        overPromoteTargetRef.current = overPromoteTarget
        onPromoteHover?.(overPromoteTarget)
      }
      if (overPromoteTarget) {
        return
      }

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

      // Drop THEN end, the same order the HTML5 path fires drop and dragend in.
      // onDragEnd still runs on a promote drop: it is what clears
      // activeDragTaskId and the row's opacity-0 flight state, so skipping it
      // would leave the row invisible after a successful move.
      const promoted = overPromoteTargetRef.current
      overPromoteTargetRef.current = false
      setMobileDragState(null)
      mobileDragTouchIdRef.current = null
      if (promoted) {
        onDropOnPromoteTarget?.()
      }
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
    onPromoteHover,
    onDropOnPromoteTarget,
  ])

  return { startMobileDrag }
}
