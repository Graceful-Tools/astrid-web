import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useSlideCloseAnimation } from '@/hooks/task-manager/useSlideCloseAnimation'

describe('useSlideCloseAnimation', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('bypasses animation and calls onComplete synchronously when bypassAnimation is true', () => {
    const { result } = renderHook(() => useSlideCloseAnimation({ bypassAnimation: true }))
    const onComplete = vi.fn()

    act(() => {
      result.current.runAnimatedClose(onComplete)
    })

    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(result.current.isClosing).toBe(false)
  })

  it('sets isClosing to true during animation and calls onComplete after duration', () => {
    const { result } = renderHook(() => useSlideCloseAnimation({ bypassAnimation: false, duration: 300 }))
    const onComplete = vi.fn()

    act(() => {
      result.current.runAnimatedClose(onComplete)
    })

    expect(result.current.isClosing).toBe(true)
    expect(onComplete).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(300)
    })

    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(result.current.isClosing).toBe(false)
  })

  it('supports a custom duration passed to runAnimatedClose', () => {
    const { result } = renderHook(() => useSlideCloseAnimation({ bypassAnimation: false, duration: 300 }))
    const onComplete = vi.fn()

    act(() => {
      result.current.runAnimatedClose(onComplete, 200)
    })

    act(() => {
      vi.advanceTimersByTime(199)
    })
    expect(onComplete).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('cancels a pending timer when runAnimatedClose is called again', () => {
    const { result } = renderHook(() => useSlideCloseAnimation({ bypassAnimation: false, duration: 300 }))
    const first = vi.fn()
    const second = vi.fn()

    act(() => {
      result.current.runAnimatedClose(first)
    })

    act(() => {
      vi.advanceTimersByTime(100)
      result.current.runAnimatedClose(second)
    })

    act(() => {
      vi.advanceTimersByTime(300)
    })

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('cancel() clears pending timer and resets isClosing', () => {
    const { result } = renderHook(() => useSlideCloseAnimation({ bypassAnimation: false, duration: 300 }))
    const onComplete = vi.fn()

    act(() => {
      result.current.runAnimatedClose(onComplete)
    })
    expect(result.current.isClosing).toBe(true)

    act(() => {
      result.current.cancel()
    })

    expect(result.current.isClosing).toBe(false)

    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(onComplete).not.toHaveBeenCalled()
  })

  it('clears pending timer on unmount (no callback after unmount)', () => {
    const { result, unmount } = renderHook(() => useSlideCloseAnimation({ bypassAnimation: false, duration: 300 }))
    const onComplete = vi.fn()

    act(() => {
      result.current.runAnimatedClose(onComplete)
    })

    unmount()

    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(onComplete).not.toHaveBeenCalled()
  })
})
