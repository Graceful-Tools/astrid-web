import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { useSwipeToDismiss } from '@/hooks/use-swipe-to-dismiss'

describe('useSwipeToDismiss', () => {
  it('should call onDismiss when swiping right with sufficient distance', () => {
    const onDismiss = vi.fn()
    const { result } = renderHook(() =>
      useSwipeToDismiss({ onDismiss }, { direction: 'right', threshold: 50 })
    )

    // Mock touch event
    const mockTouchEvent = {
      touches: [{ clientX: 100, clientY: 100 }],
    } as unknown as React.TouchEvent

    // Start touch
    act(() => {
      result.current.onTouchStart(mockTouchEvent)
    })

    // Move touch right by 60 pixels (above threshold)
    const mockMoveEvent = {
      touches: [{ clientX: 160, clientY: 100 }],
    } as unknown as React.TouchEvent

    act(() => {
      result.current.onTouchMove(mockMoveEvent)
    })

    // End touch
    act(() => {
      result.current.onTouchEnd()
    })

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('should not call onDismiss when swipe distance is below threshold', () => {
    const onDismiss = vi.fn()
    const { result } = renderHook(() =>
      useSwipeToDismiss({ onDismiss }, { direction: 'right', threshold: 50 })
    )

    const mockTouchEvent = {
      touches: [{ clientX: 100, clientY: 100 }],
    } as unknown as React.TouchEvent

    act(() => {
      result.current.onTouchStart(mockTouchEvent)
    })

    // Move touch right by only 30 pixels (below threshold)
    const mockMoveEvent = {
      touches: [{ clientX: 130, clientY: 100 }],
    } as unknown as React.TouchEvent

    act(() => {
      result.current.onTouchMove(mockMoveEvent)
    })

    act(() => {
      result.current.onTouchEnd()
    })

    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('should not call onDismiss when swiping in wrong direction', () => {
    const onDismiss = vi.fn()
    const { result } = renderHook(() =>
      useSwipeToDismiss({ onDismiss }, { direction: 'right', threshold: 50 })
    )

    const mockTouchEvent = {
      touches: [{ clientX: 100, clientY: 100 }],
    } as unknown as React.TouchEvent

    act(() => {
      result.current.onTouchStart(mockTouchEvent)
    })

    // Move touch left instead of right
    const mockMoveEvent = {
      touches: [{ clientX: 40, clientY: 100 }],
    } as unknown as React.TouchEvent

    act(() => {
      result.current.onTouchMove(mockMoveEvent)
    })

    act(() => {
      result.current.onTouchEnd()
    })

    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('should work with down direction for vertical swipes', () => {
    const onDismiss = vi.fn()
    const { result } = renderHook(() =>
      useSwipeToDismiss({ onDismiss }, { direction: 'down', threshold: 80 })
    )

    const mockTouchEvent = {
      touches: [{ clientX: 100, clientY: 100 }],
    } as unknown as React.TouchEvent

    act(() => {
      result.current.onTouchStart(mockTouchEvent)
    })

    // Move touch down by 90 pixels (above threshold)
    const mockMoveEvent = {
      touches: [{ clientX: 100, clientY: 190 }],
    } as unknown as React.TouchEvent

    act(() => {
      result.current.onTouchMove(mockMoveEvent)
    })

    act(() => {
      result.current.onTouchEnd()
    })

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('should not track touches when trackTouch is disabled', () => {
    const onDismiss = vi.fn()
    const { result } = renderHook(() =>
      useSwipeToDismiss({ onDismiss }, { direction: 'right', threshold: 50, trackTouch: false })
    )

    const mockTouchEvent = {
      touches: [{ clientX: 100, clientY: 100 }],
    } as unknown as React.TouchEvent

    act(() => {
      result.current.onTouchStart(mockTouchEvent)
    })

    const mockMoveEvent = {
      touches: [{ clientX: 160, clientY: 100 }],
    } as unknown as React.TouchEvent

    act(() => {
      result.current.onTouchMove(mockMoveEvent)
    })

    act(() => {
      result.current.onTouchEnd()
    })

    expect(onDismiss).not.toHaveBeenCalled()
  })
})