import { useCallback, useState } from "react"
import { useSlideCloseAnimation } from "./useSlideCloseAnimation"

export interface UseTaskPaneStateProps {
  selectedTaskId: string
  isMobile: boolean
  setSelectedTaskId: (id: string) => void
  setSelectedTaskElement: (el: HTMLElement | null) => void
}

export interface UseTaskPaneStateReturn {
  isTaskPaneClosing: boolean
  taskPanePosition: { left: number }
  setIsTaskPaneClosing: React.Dispatch<React.SetStateAction<boolean>>
  setTaskPanePosition: React.Dispatch<React.SetStateAction<{ left: number }>>
  closeTaskPaneAnimated: () => void
}

export function useTaskPaneState({
  selectedTaskId,
  isMobile,
  setSelectedTaskId,
  setSelectedTaskElement,
}: UseTaskPaneStateProps): UseTaskPaneStateReturn {
  const [taskPanePosition, setTaskPanePosition] = useState({ left: 0 })

  const { isClosing, runAnimatedClose, cancel } = useSlideCloseAnimation({
    bypassAnimation: !selectedTaskId || isMobile,
    duration: 300,
  })

  const closeTaskPaneAnimated = useCallback(() => {
    // Already sliding out — ignore repeat close requests. Momentum scroll fires
    // closeTaskDetail (→ here) on every scroll event; without this guard each
    // repeat restarts the unmount timer, the CSS slide-out finishes with nothing
    // holding the end state, and the still-mounted pane snaps back into view
    // (it "reappears" until scrolling stops).
    if (isClosing) return
    runAnimatedClose(() => {
      setSelectedTaskId("")
      setSelectedTaskElement(null)
    })
  }, [isClosing, runAnimatedClose, setSelectedTaskId, setSelectedTaskElement])

  const setIsTaskPaneClosing: React.Dispatch<React.SetStateAction<boolean>> = useCallback(
    (value) => {
      const next = typeof value === 'function' ? (value as (prev: boolean) => boolean)(isClosing) : value
      if (!next) cancel()
    },
    [isClosing, cancel],
  )

  return {
    isTaskPaneClosing: isClosing,
    taskPanePosition,
    setIsTaskPaneClosing,
    setTaskPanePosition,
    closeTaskPaneAnimated,
  }
}
