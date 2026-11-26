import * as React from 'react'
import { computeTaskPaneLeftOffset } from '@/components/TaskManager/task-pane-position'

interface UseTaskPanePositionArgs {
  active: boolean
  is1Column: boolean
  is2Column: boolean
  is3Column: boolean
  showHamburgerMenu: boolean
  sidebarRef: React.MutableRefObject<HTMLDivElement | null>
  taskManagerRef: React.MutableRefObject<HTMLDivElement | null>
  setTaskPanePosition: (position: { left: number }) => void
}

/**
 * Keeps the inline task panel's left offset in step with the measured sidebar and
 * main-column widths. The window width keeps it on screen when messages is hidden
 * (AWTD-1205). ADEV-288: the main column can change width without a window resize
 * (messages pane toggled, list view settling, sidebar collapsing), so re-measure
 * on those too, or the panel opens at a stale offset, over or away from the list.
 */
export function useTaskPanePosition({
  active, is1Column, is2Column, is3Column, showHamburgerMenu,
  sidebarRef, taskManagerRef, setTaskPanePosition,
}: UseTaskPanePositionArgs) {
  React.useEffect(() => {
    const calculatePosition = () => {
      if (sidebarRef.current && taskManagerRef.current && active && !is1Column) {
        const sidebarRect = sidebarRef.current.getBoundingClientRect()
        const taskManagerRect = taskManagerRef.current.getBoundingClientRect()
        const leftOffset = computeTaskPaneLeftOffset(sidebarRect.width, taskManagerRect.width,
          { is2Column, is3Column, showHamburgerMenu }, window.innerWidth)
        setTaskPanePosition({ left: leftOffset })
      }
    }

    calculatePosition()
    window.addEventListener('resize', calculatePosition)

    let observer: ResizeObserver | undefined
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(calculatePosition)
      if (sidebarRef.current) observer.observe(sidebarRef.current)
      if (taskManagerRef.current) observer.observe(taskManagerRef.current)
    }

    return () => {
      window.removeEventListener('resize', calculatePosition)
      observer?.disconnect()
    }
  }, [active, is1Column, is2Column, is3Column, showHamburgerMenu, setTaskPanePosition, sidebarRef, taskManagerRef])
}
