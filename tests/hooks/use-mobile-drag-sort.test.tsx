/**
 * @vitest-environment jsdom
 */

/**
 * Task 77b27e62 — Stage 17: extracting MainContent's mobile manual-sort
 * touch state machine into hooks/use-mobile-drag-sort.ts. Owns the
 * document-level touchmove/touchend/touchcancel listeners + the state
 * that gates them.
 *
 * jsdom has no layout, so the above/below position of a reorder hover is
 * exercised manually on a real device. The first block pins the lifecycle:
 * listeners attach only after startMobileDrag in the right mode, touchend
 * clears state + fires onDragEnd, and prerequisites toggling off detaches
 * listeners. The second (merged in from use-mobile-drag-sort-promote.test.tsx,
 * AWTD-1343) stubs `document.elementFromPoint` to test which callback fires for
 * which element the finger is over.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRef } from 'react'
import { useMobileDragSort } from '@/hooks/use-mobile-drag-sort'
import { PROMOTE_DROP_TARGET_ID } from '@/lib/subtask-promotion'

type Opts = Parameters<typeof useMobileDragSort>[0]

function defaultOpts(overrides: Partial<Opts> = {}): Opts {
  return {
    isTouchManualSort: true,
    manualSortActive: true,
    activeDragTaskId: 'task-1',
    taskListContainerRef: { current: null } as React.RefObject<HTMLElement | null>,
    onDragHover: vi.fn(),
    onDragHoverEnd: vi.fn(),
    onDragEnd: vi.fn(),
    onPromoteHover: vi.fn(),
    onDropOnPromoteTarget: vi.fn(),
    ...overrides,
  }
}

/** jsdom builds no TouchList; this is the array-like with .item() the hook reads. */
function fakeTouch(identifier: number, clientY = 10) {
  const touch = { identifier, clientX: 5, clientY } as unknown as Touch
  const list: TouchList = Object.assign([touch], {
    item: (i: number) => [touch][i] ?? null,
  }) as unknown as TouchList
  return list
}

function dispatchTouch(type: 'touchmove' | 'touchend', identifier: number, clientY = 10) {
  const list = fakeTouch(identifier, clientY)
  const event = new Event(type) as TouchEvent
  Object.defineProperty(event, type === 'touchend' ? 'changedTouches' : 'touches', { value: list })
  // touchmove reads .touches; the hook calls preventDefault on both.
  Object.defineProperty(event, 'preventDefault', { value: vi.fn() })
  act(() => {
    document.dispatchEvent(event)
  })
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

    // A touchend whose changedTouches identifier matches the tracked id.
    dispatchTouch('touchend', 3)

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

/** The strip MainContent renders while a subtask is in flight. */
function mountPromoteTarget(): HTMLElement {
  const strip = document.createElement('div')
  strip.id = PROMOTE_DROP_TARGET_ID
  strip.setAttribute('data-testid', 'promote-to-top-level-target')
  document.body.appendChild(strip)
  return strip
}

/** A task row, so we can prove the two destinations stay distinguishable. */
function mountTaskRow(taskId: string): HTMLElement {
  const row = document.createElement('div')
  row.setAttribute('data-task-id', taskId)
  row.getBoundingClientRect = () =>
    ({ top: 0, height: 100, left: 0, right: 0, bottom: 100, width: 100, x: 0, y: 0 }) as DOMRect
  document.body.appendChild(row)
  return row
}

function pointAt(element: Element | null) {
  document.elementFromPoint = vi.fn().mockReturnValue(element) as typeof document.elementFromPoint
}

/**
 * "Move out of subtask" by touch (Jon, 2026-08-19).
 *
 * Dragging a subtask onto the "Drop here to move out of its parent task" strip
 * clears its `parentTaskId`. That strip is wired with HTML5 `onDragOver` /
 * `onDrop` (MainContent), so it has ALWAYS been mouse-only — this was never an
 * iPad-specific gap. The touch state machine walked `elementFromPoint` looking
 * for `[data-task-id]` and nothing else, so a finger landing on the strip
 * simply ended the drag as if it had been dropped nowhere.
 *
 * The hook's job here is narrow and deliberately stops at REPORTING: it says
 * "the finger is over the promote target" and "the finger lifted while over
 * it". It does not clear the pending reorder itself, because the hook does not
 * own that state — MainContent does, and it already has
 * `handleTaskDragLeaveTask` for exactly this. Deciding here would mean the hook
 * guessing at a reorder target it cannot see.
 *
 * jsdom cannot do `document.elementFromPoint` — it has no layout — but the
 * function can be stubbed, and once it is, the routing (which element the
 * finger is over → which callback fires) is ordinary logic and testable.
 */
describe('dragging a subtask onto the promote target by touch', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('reports the finger arriving over the promote target — not as a reorder target', () => {
    const opts = defaultOpts()
    const strip = mountPromoteTarget()
    const { result } = renderHook(() => useMobileDragSort(opts))

    act(() => result.current.startMobileDrag('task-1', 4))
    pointAt(strip)
    dispatchTouch('touchmove', 4)

    expect(opts.onPromoteHover).toHaveBeenCalledWith(true)
    expect(opts.onDragHover).not.toHaveBeenCalled()
  })

  it('reports the finger leaving again, so the strip can stop looking armed', () => {
    const opts = defaultOpts()
    const strip = mountPromoteTarget()
    const row = mountTaskRow('task-2')
    const { result } = renderHook(() => useMobileDragSort(opts))

    act(() => result.current.startMobileDrag('task-1', 4))
    pointAt(strip)
    dispatchTouch('touchmove', 4)
    pointAt(row)
    dispatchTouch('touchmove', 4)

    expect(opts.onPromoteHover).toHaveBeenLastCalledWith(false)
  })

  it('promotes when the finger lifts over the target, and still ends the drag', () => {
    // The HTML5 path fires drop AND dragend; skipping the end here would leave
    // activeDragTaskId set and the row stuck at opacity 0.
    const opts = defaultOpts()
    const strip = mountPromoteTarget()
    const { result } = renderHook(() => useMobileDragSort(opts))

    act(() => result.current.startMobileDrag('task-1', 4))
    pointAt(strip)
    dispatchTouch('touchmove', 4)
    dispatchTouch('touchend', 4)

    expect(opts.onDropOnPromoteTarget).toHaveBeenCalledTimes(1)
    expect(opts.onDragEnd).toHaveBeenCalledTimes(1)
  })

  it('does not promote when the finger lifts over a row instead', () => {
    const opts = defaultOpts()
    const row = mountTaskRow('task-2')
    const { result } = renderHook(() => useMobileDragSort(opts))

    act(() => result.current.startMobileDrag('task-1', 4))
    pointAt(row)
    dispatchTouch('touchmove', 4)
    dispatchTouch('touchend', 4)

    expect(opts.onDropOnPromoteTarget).not.toHaveBeenCalled()
    expect(opts.onDragEnd).toHaveBeenCalledTimes(1)
  })

  it('does not promote when the drag never touched the target at all', () => {
    const opts = defaultOpts()
    const { result } = renderHook(() => useMobileDragSort(opts))

    act(() => result.current.startMobileDrag('task-1', 4))
    pointAt(null)
    dispatchTouch('touchmove', 4)
    dispatchTouch('touchend', 4)

    expect(opts.onDropOnPromoteTarget).not.toHaveBeenCalled()
  })

  it('works when the finger is over a child of the strip, not the strip itself', () => {
    const opts = defaultOpts()
    const strip = mountPromoteTarget()
    const label = document.createElement('span')
    strip.appendChild(label)
    const { result } = renderHook(() => useMobileDragSort(opts))

    act(() => result.current.startMobileDrag('task-1', 4))
    pointAt(label)
    dispatchTouch('touchmove', 4)

    expect(opts.onPromoteHover).toHaveBeenCalledWith(true)
  })
})
