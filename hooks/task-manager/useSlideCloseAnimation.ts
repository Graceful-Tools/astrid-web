import { useCallback, useEffect, useRef, useState } from "react"

export interface UseSlideCloseAnimationOptions {
  bypassAnimation: boolean
  duration?: number
}

export interface UseSlideCloseAnimationReturn {
  isClosing: boolean
  runAnimatedClose: (onComplete: () => void, customDuration?: number) => void
  cancel: () => void
}

export function useSlideCloseAnimation({
  bypassAnimation,
  duration = 300,
}: UseSlideCloseAnimationOptions): UseSlideCloseAnimationReturn {
  const [isClosing, setIsClosing] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const cancel = useCallback(() => {
    clearTimer()
    setIsClosing(false)
  }, [clearTimer])

  const runAnimatedClose = useCallback(
    (onComplete: () => void, customDuration?: number) => {
      if (bypassAnimation) {
        clearTimer()
        onComplete()
        return
      }
      clearTimer()
      setIsClosing(true)
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        onComplete()
        setIsClosing(false)
      }, customDuration ?? duration)
    },
    [bypassAnimation, duration, clearTimer],
  )

  useEffect(() => {
    return () => {
      clearTimer()
    }
  }, [clearTimer])

  return { isClosing, runAnimatedClose, cancel }
}
