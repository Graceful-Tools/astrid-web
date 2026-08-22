/**
 * @vitest-environment jsdom
 */

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
 * The existing suite notes that jsdom cannot do `document.elementFromPoint`.
 * True — it has no layout — but the function can be stubbed, and once it is,
 * the routing this file cares about (which element the finger is over → which
 * callback fires) is ordinary logic and testable.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
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

describe('dragging a subtask onto the promote target by touch', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('reports the finger arriving over the promote target', () => {
    const opts = defaultOpts()
    const strip = mountPromoteTarget()
    const { result } = renderHook(() => useMobileDragSort(opts))

    act(() => result.current.startMobileDrag('task-1', 4))
    pointAt(strip)
    dispatchTouch('touchmove', 4)

    expect(opts.onPromoteHover).toHaveBeenCalledWith(true)
  })

  it('does not mistake the promote target for a reorder target', () => {
    const opts = defaultOpts()
    const strip = mountPromoteTarget()
    const { result } = renderHook(() => useMobileDragSort(opts))

    act(() => result.current.startMobileDrag('task-1', 4))
    pointAt(strip)
    dispatchTouch('touchmove', 4)

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

  it('promotes when the finger lifts over the target', () => {
    const opts = defaultOpts()
    const strip = mountPromoteTarget()
    const { result } = renderHook(() => useMobileDragSort(opts))

    act(() => result.current.startMobileDrag('task-1', 4))
    pointAt(strip)
    dispatchTouch('touchmove', 4)
    dispatchTouch('touchend', 4)

    expect(opts.onDropOnPromoteTarget).toHaveBeenCalledTimes(1)
  })

  it('still ends the drag on a promote drop, so the row is not left mid-flight', () => {
    // The HTML5 path fires drop AND dragend; skipping the end here would leave
    // activeDragTaskId set and the row stuck at opacity 0.
    const opts = defaultOpts()
    const strip = mountPromoteTarget()
    const { result } = renderHook(() => useMobileDragSort(opts))

    act(() => result.current.startMobileDrag('task-1', 4))
    pointAt(strip)
    dispatchTouch('touchmove', 4)
    dispatchTouch('touchend', 4)

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
