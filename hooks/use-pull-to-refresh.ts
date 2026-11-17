import { useRef, useCallback, useState, useEffect } from 'react'

interface PullToRefreshOptions {
  threshold?: number
  maxDistance?: number
  onRefresh?: () => Promise<void> | void
  disabled?: boolean
}

function hasScrolledAncestor(element: HTMLElement): boolean {
  for (let el = element.parentElement; el; el = el.parentElement) {
    if (el.scrollTop > 0 && el.scrollHeight > el.clientHeight) return true
  }
  return false
}

export function usePullToRefresh(options: PullToRefreshOptions = {}) {
  const {
    threshold = 60,
    maxDistance = 120,
    onRefresh,
    disabled = false
  } = options

  const [isRefreshing, setIsRefreshing] = useState(false)
  const [pullDistance, setPullDistance] = useState(0)
  const [isPulling, setIsPulling] = useState(false)
  const [boundElement, setBoundElement] = useState<HTMLElement | null>(null)

  const touchStartRef = useRef<{ y: number; scrollTop: number } | null>(null)
  // Track pullDistance synchronously for touch handlers
  const pullDistanceRef = useRef(0)
  const optionsRef = useRef({ disabled, isRefreshing, threshold, onRefresh, maxDistance })

  // Keep optionsRef in sync (but not pullDistance - that's tracked separately)
  useEffect(() => {
    optionsRef.current = { disabled, isRefreshing, threshold, onRefresh, maxDistance }
  }, [disabled, isRefreshing, threshold, onRefresh, maxDistance])

  // Use native event listeners to allow preventDefault on touch events
  useEffect(() => {
    const element = boundElement
    if (!element) return

    const handleTouchStart = (e: TouchEvent) => {
      const { disabled, isRefreshing } = optionsRef.current
      if (disabled || isRefreshing) return

      const scrollTop = element.scrollTop
      const touch = e.touches[0]

      // Only enable pull-to-refresh when scrolled to top, and when no scrolling ancestor is
      // scrolled down: a downward drag there is that pane scrolling up (ADEV-74).
      if (scrollTop === 0 && !hasScrolledAncestor(element)) {
        touchStartRef.current = {
          y: touch.clientY,
          scrollTop
        }
      }
    }

    const handleTouchMove = (e: TouchEvent) => {
      const { disabled, isRefreshing, maxDistance } = optionsRef.current
      if (disabled || isRefreshing || !touchStartRef.current) return

      const touch = e.touches[0]
      const deltaY = touch.clientY - touchStartRef.current.y
      const scrollTop = element.scrollTop

      // Only pull down when at top of scroll
      if (scrollTop === 0 && deltaY > 0) {
        e.preventDefault() // This now works because listener is not passive
        const distance = Math.min(deltaY * 0.5, maxDistance)
        pullDistanceRef.current = distance // Update ref synchronously
        setPullDistance(distance)
        setIsPulling(true)
      }
    }

    const handleTouchEnd = async () => {
      const { disabled, isRefreshing, threshold, onRefresh } = optionsRef.current
      const currentPullDistance = pullDistanceRef.current // Read from ref, not state

      if (disabled || isRefreshing || !touchStartRef.current) return

      if (currentPullDistance >= threshold && onRefresh) {
        setIsRefreshing(true)
        try {
          await onRefresh()
        } catch (error) {
          console.error('Pull to refresh error:', error)
        } finally {
          setIsRefreshing(false)
        }
      }

      // Reset state
      pullDistanceRef.current = 0
      setPullDistance(0)
      setIsPulling(false)
      touchStartRef.current = null
    }

    // Add listeners with { passive: false } to allow preventDefault
    element.addEventListener('touchstart', handleTouchStart, { passive: true })
    element.addEventListener('touchmove', handleTouchMove, { passive: false })
    element.addEventListener('touchend', handleTouchEnd, { passive: true })

    return () => {
      element.removeEventListener('touchstart', handleTouchStart)
      element.removeEventListener('touchmove', handleTouchMove)
      element.removeEventListener('touchend', handleTouchEnd)
    }
  }, [boundElement]) // Re-run when element changes

  const bindToElement = useCallback((element: HTMLElement | null) => {
    setBoundElement(element)
  }, [])

  // Keep React event handlers as no-ops for backwards compatibility
  const onTouchStart = useCallback(() => {}, [])
  const onTouchMove = useCallback(() => {}, [])
  const onTouchEnd = useCallback(() => {}, [])

  return {
    isRefreshing,
    pullDistance,
    isPulling,
    canRefresh: pullDistance >= threshold,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    bindToElement
  }
}
