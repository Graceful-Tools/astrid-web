/**
 * @vitest-environment jsdom
 */

/**
 * Task 77b27e62 — Stage 17: extracting MainContent's mobile manual-sort
 * touch state machine into hooks/use-mobile-drag-sort.ts. Owns the
 * document-level touchmove/touchend/touchcancel listeners + the state
 * that gates them.
 *
 * jsdom can't simulate `document.elementFromPoint`, so the hover-routing
 * logic (touchmove → hovered task → above/below position) is exercised
 * manually on a real device. These pin the lifecycle: listeners attach
 * only after startMobileDrag in the right mode, touchend clears state +
 * fires onDragEnd, and prerequisites toggling off detaches listeners.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRef } from 'react'
import { useMobileDragSort } from '@/hooks/use-mobile-drag-sort'

type Opts = Parameters<typeof useMobileDragSort>[0]

function defaultOpts(): Opts {
  return {
    isTouchManualSort: true,
    manualSortActive: true,
    activeDragTaskId: 'task-1',
    taskListContainerRef: { current: null } as React.RefObject<HTMLElement | null>,
    onDragHover: vi.fn(),
    onDragHoverEnd: vi.fn(),
    onDragEnd: vi.fn(),
  }
}

describe('useMobileDragSort', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('does not attach document touch listeners until startMobileDrag is called', () => {
    const addSpy = vi.spyOn(document, 'addEventListener')
    renderHook(() => useMobileDragSort(defaultOpts()))

    expect(addSpy.mock.calls.find(([type]) => type === 'touchmove')).toBeUndefined()
    expect(addSpy.mock.calls.find(([type]) => type === 'touchend')).toBeUndefined()
  })

  it('attaches touchmove + touchend + touchcancel after startMobileDrag', () => {
    const addSpy = vi.spyOn(document, 'addEventListener')
    const { result } = renderHook(() => useMobileDragSort(defaultOpts()))

    act(() => result.current.startMobileDrag('task-1', 7))

    const types = addSpy.mock.calls.map(([t]) => t)
    expect(types).toContain('touchmove')
    expect(types).toContain('touchend')
    expect(types).toContain('touchcancel')
  })

  it('never attaches listeners when isTouchManualSort is false, even after start', () => {
    const addSpy = vi.spyOn(document, 'addEventListener')
    const { result } = renderHook(() =>
      useMobileDragSort({ ...defaultOpts(), isTouchManualSort: false })
    )

    act(() => result.current.startMobileDrag('task-1', 0))

    expect(addSpy.mock.calls.find(([type]) => type === 'touchmove')).toBeUndefined()
  })

  it('fires onDragEnd and detaches listeners on touchend', () => {
    const opts = defaultOpts()
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    const { result } = renderHook(() => useMobileDragSort(opts))

    act(() => result.current.startMobileDrag('task-1', 3))

    // Dispatch a touchend whose changedTouches identifier matches the tracked id.
    // jsdom doesn't construct TouchList objects, so we provide a minimal
    // array-like with the .item() method the hook calls.
    const touch = { identifier: 3, clientX: 0, clientY: 0 } as unknown as Touch
    const changedTouches: TouchList = Object.assign([touch], {
      item: (i: number) => [touch][i] ?? null,
    }) as unknown as TouchList
    const ev = new Event('touchend') as TouchEvent
    Object.defineProperty(ev, 'changedTouches', { value: changedTouches })
    act(() => {
      document.dispatchEvent(ev)
    })

    expect(opts.onDragEnd).toHaveBeenCalledTimes(1)
    const removed = removeSpy.mock.calls.map(([t]) => t)
    expect(removed).toContain('touchmove')
    expect(removed).toContain('touchend')
  })

  it('detaches listeners when activeDragTaskId clears mid-drag', () => {
    const opts = defaultOpts()
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    const { result, rerender } = renderHook((p: Opts) => useMobileDragSort(p), {
      initialProps: opts,
    })

    act(() => result.current.startMobileDrag('task-1', 1))
    removeSpy.mockClear()

    // Parent clears the active drag — hook should reset state, detaching listeners.
    rerender({ ...opts, activeDragTaskId: null })

    expect(removeSpy.mock.calls.map(([t]) => t)).toEqual(
      expect.arrayContaining(['touchmove', 'touchend', 'touchcancel'])
    )
  })

  it('detaches listeners when manualSortActive toggles off', () => {
    const opts = defaultOpts()
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    const { result, rerender } = renderHook((p: Opts) => useMobileDragSort(p), {
      initialProps: opts,
    })

    act(() => result.current.startMobileDrag('task-1', 1))
    removeSpy.mockClear()

    rerender({ ...opts, manualSortActive: false })

    expect(removeSpy.mock.calls.map(([t]) => t)).toEqual(
      expect.arrayContaining(['touchmove', 'touchend'])
    )
  })

  it('is usable inside a real React component with a real ref', () => {
    // Smoke check: the hook compiles when the ref comes from useRef.
    const { result } = renderHook(() => {
      const ref = useRef<HTMLElement | null>(null)
      return useMobileDragSort({ ...defaultOpts(), taskListContainerRef: ref })
    })
    expect(typeof result.current.startMobileDrag).toBe('function')
  })
})
