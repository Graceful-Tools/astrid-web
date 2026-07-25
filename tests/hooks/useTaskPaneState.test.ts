import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useTaskPaneState } from '@/hooks/task-manager/useTaskPaneState'

describe('useTaskPaneState', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function setup() {
    const setSelectedTaskId = vi.fn()
    const setSelectedTaskElement = vi.fn()
    const utils = renderHook(() =>
      useTaskPaneState({
        selectedTaskId: 'task-1',
        isMobile: false,
        setSelectedTaskId,
        setSelectedTaskElement,
      }),
    )
    return { ...utils, setSelectedTaskId, setSelectedTaskElement }
  }

  it('closes the pane after the animation duration', () => {
    const { result, setSelectedTaskId } = setup()

    act(() => {
      result.current.closeTaskPaneAnimated()
    })
    expect(result.current.isTaskPaneClosing).toBe(true)
    expect(setSelectedTaskId).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(300)
    })

    expect(setSelectedTaskId).toHaveBeenCalledWith('')
    expect(result.current.isTaskPaneClosing).toBe(false)
  })

  // Regression for the scroll-to-close bug: while the pane is sliding out,
  // momentum scroll fires closeTaskDetail -> closeTaskPaneAnimated many times.
  // Each repeat must NOT restart the unmount timer, otherwise the CSS slide-out
  // animation finishes (no fill-mode) and the still-mounted pane snaps back into
  // view -> it "reappears" until the user stops scrolling.
  it('does not postpone the unmount when called repeatedly mid-close (momentum scroll)', () => {
    const { result, setSelectedTaskId } = setup()

    act(() => {
      result.current.closeTaskPaneAnimated() // first scroll event starts the close
    })

    // Simulate a stream of scroll events every 50ms across the animation window.
    for (let elapsed = 50; elapsed < 300; elapsed += 50) {
      act(() => {
        vi.advanceTimersByTime(50)
        result.current.closeTaskPaneAnimated() // repeat while already closing
      })
    }

    // We are now 250ms in with repeated calls. Advance the remaining 50ms so a
    // total of 300ms has passed since the FIRST call.
    act(() => {
      vi.advanceTimersByTime(50)
    })

    // The pane must have unmounted on the original 300ms schedule, not been
    // pushed out by the repeated calls.
    expect(setSelectedTaskId).toHaveBeenCalledWith('')
    expect(setSelectedTaskId).toHaveBeenCalledTimes(1)
    expect(result.current.isTaskPaneClosing).toBe(false)
  })
})
