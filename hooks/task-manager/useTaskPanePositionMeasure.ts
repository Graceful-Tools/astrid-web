import { useEffect } from "react"
import { taskPaneLeftOffsetFromMainRect } from "@/components/TaskManager/task-pane-position"

interface UseTaskPanePositionMeasureInput {
  taskManagerRef: React.MutableRefObject<HTMLDivElement | null>
  /** A task or a settings sub-page is showing in the pane. */
  open: boolean
  is1Column: boolean
  is2Column: boolean
  is3Column: boolean
  showHamburgerMenu: boolean
  /** Only re-runs the effect: switching surface can swap the column element. */
  isBoardMode: boolean
  isSettingsActive: boolean
  setTaskPanePosition: (position: { left: number }) => void
}

/**
 * Measures where the fixed list-view details pane starts (ADEV-288).
 *
 * Measured from the main column alone: whatever is to its left (the sidebar,
 * the collapsed rail, nothing) is its rect's left edge. This used to require
 * `sidebarRef`, which the collapsed rail never attaches, so the pane stayed at
 * `left: 0` over the list or at an offset taken with the sidebar open, over the
 * chat. Collapsing or opening the sidebar moves the column without resizing the
 * window, so a ResizeObserver on the column re-measures it as well.
 */
export function useTaskPanePositionMeasure({
  taskManagerRef,
  open,
  is1Column,
  is2Column,
  is3Column,
  showHamburgerMenu,
  isBoardMode,
  isSettingsActive,
  setTaskPanePosition,
}: UseTaskPanePositionMeasureInput): void {
  useEffect(() => {
    const calculatePosition = () => {
      if (taskManagerRef.current && open && !is1Column) {
        // The window width keeps the panel on screen when messages is hidden (AWTD-1205).
        setTaskPanePosition({
          left: taskPaneLeftOffsetFromMainRect(taskManagerRef.current.getBoundingClientRect(),
            { is2Column, is3Column, showHamburgerMenu }, window.innerWidth),
        })
      }
    }

    calculatePosition()
    window.addEventListener('resize', calculatePosition)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(calculatePosition)
    if (observer && taskManagerRef.current) observer.observe(taskManagerRef.current)

    return () => {
      window.removeEventListener('resize', calculatePosition)
      observer?.disconnect()
    }
  }, [open, is1Column, is2Column, is3Column, showHamburgerMenu, isBoardMode, isSettingsActive, setTaskPanePosition, taskManagerRef])
}
