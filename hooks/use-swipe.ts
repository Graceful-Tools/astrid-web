import { useRef, useCallback } from 'react'
import { touchOwner } from '@/lib/gestures/swipe-owner'

interface SwipeHandlers {
  onSwipeLeft?: () => void
  onSwipeRight?: () => void
  onSwipeUp?: () => void
  onSwipeDown?: () => void
  // Real-time progress callback for interactive drag feedback
  // deltaX: horizontal distance dragged (positive = right)
  // deltaY: vertical distance dragged (positive = down)
  // progress: normalized progress 0-1 toward threshold
  onSwipeProgress?: (deltaX: number, deltaY: number, progress: number) => void
  // Called when touch ends without completing swipe (for spring-back animation)
  onSwipeCancel?: () => void
}

interface SwipeOptions {
  threshold?: number
  preventScrollOnSwipe?: boolean
  trackTouch?: boolean
  // iOS-style edge swipe: if swipe starts within edgeZone pixels of left edge,
  // use edgeThreshold instead of threshold for easier back navigation
  edgeZone?: number
  edgeThreshold?: number
}

export function useSwipe(handlers: SwipeHandlers, options: SwipeOptions = {}) {
  const {
    threshold = 50,
    preventScrollOnSwipe = false,
    trackTouch = true,
    edgeZone = 20,
    edgeThreshold = 30,
  } = options

  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const touchEndRef = useRef<{ x: number; y: number } | null>(null)
  const isEdgeSwipeRef = useRef(false)

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (!trackTouch) return
    const touch = e.touches[0]
    const isEdge = touch.clientX <= edgeZone
    touchEndRef.current = null
    // A sideways scroller (a trade-off grid, a code block) or a portalled dialog owns this
    // gesture. An edge swipe on the surface itself still goes back (AWTD-1534).
    const owner = touchOwner(e.target, e.currentTarget)
    if (owner === 'portal' || (owner === 'scroller' && !isEdge)) {
      touchStartRef.current = null
      isEdgeSwipeRef.current = false
      return
    }
    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
    }
    // Detect if swipe started from left edge (iOS-style edge swipe)
    isEdgeSwipeRef.current = isEdge
  }, [trackTouch, edgeZone])

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!trackTouch || !touchStartRef.current) return
    if (preventScrollOnSwipe) {
      e.preventDefault()
    }
    const touch = e.touches[0]
    touchEndRef.current = {
      x: touch.clientX,
      y: touch.clientY,
    }

    // Call onSwipeProgress for real-time drag feedback
    if (handlers.onSwipeProgress) {
      const deltaX = touch.clientX - touchStartRef.current.x
      const deltaY = touch.clientY - touchStartRef.current.y
      const absDeltaX = Math.abs(deltaX)
      const absDeltaY = Math.abs(deltaY)

      // Only report progress for horizontal swipes (when horizontal movement is dominant)
      if (absDeltaX > absDeltaY) {
        // Use edge threshold for edge swipes, regular threshold otherwise
        const effectiveThreshold = isEdgeSwipeRef.current && deltaX > 0 ? edgeThreshold : threshold
        const progress = Math.min(absDeltaX / effectiveThreshold, 1)
        handlers.onSwipeProgress(deltaX, deltaY, progress)
      }
    }
  }, [trackTouch, preventScrollOnSwipe, threshold, edgeThreshold, handlers])

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!trackTouch || !touchStartRef.current) return

    // If touchEndRef is null (no touchmove), use the touch position from touchend
    if (!touchEndRef.current && e.changedTouches?.[0]) {
      const touch = e.changedTouches[0]
      touchEndRef.current = {
        x: touch.clientX,
        y: touch.clientY,
      }
    }

    if (!touchEndRef.current) return

    const deltaX = touchEndRef.current.x - touchStartRef.current.x
    const deltaY = touchEndRef.current.y - touchStartRef.current.y
    const absDeltaX = Math.abs(deltaX)
    const absDeltaY = Math.abs(deltaY)

    // Use lower threshold for edge swipes (iOS-style back gesture)
    const effectiveThreshold = isEdgeSwipeRef.current && deltaX > 0 ? edgeThreshold : threshold

    let swipeDetected = false

    // Determine if this is a horizontal or vertical swipe
    if (absDeltaX > absDeltaY && absDeltaX > effectiveThreshold) {
      // Horizontal swipe
      swipeDetected = true
      if (deltaX > 0) {
        handlers.onSwipeRight?.()
      } else {
        handlers.onSwipeLeft?.()
      }
    } else if (absDeltaY > absDeltaX && absDeltaY > threshold) {
      // Vertical swipe
      swipeDetected = true
      if (deltaY > 0) {
        handlers.onSwipeDown?.()
      } else {
        handlers.onSwipeUp?.()
      }
    }

    // Prevent event bubbling if a swipe was detected
    if (swipeDetected) {
      e.preventDefault()
      e.stopPropagation()
    } else if (handlers.onSwipeCancel) {
      // Swipe wasn't completed - call cancel for spring-back animation
      handlers.onSwipeCancel()
    }

    // Reset
    touchStartRef.current = null
    touchEndRef.current = null
    isEdgeSwipeRef.current = false
  }, [trackTouch, threshold, edgeThreshold, handlers])

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
  }
}