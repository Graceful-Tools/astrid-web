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
    runAnimatedClose(() => {
      setSelectedTaskId("")
      setSelectedTaskElement(null)
    })
  }, [runAnimatedClose, setSelectedTaskId, setSelectedTaskElement])

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
