/**
 * @vitest-environment jsdom
 */

/**
 * Production, 2026-10-04: tapping a task in My Tasks (manual sort, Safari) threw React #185,
 * "Maximum update depth exceeded", from TaskRow's row ref.
 *
 * The row measured itself in an INLINE ref callback and stored the height in state. An inline
 * ref is a new function on every render, so React calls it again — with null, then the node —
 * after every commit. Any row whose height differs between consecutive measurements (layout
 * still settling while the detail pane opens on tap) then set state from the commit phase,
 * which committed again, which called the ref again… until React gave up.
 *
 * The row now measures with a STABLE ref and records the height from a layout effect that runs
 * only when what it depends on changes — never from the commit of its own update.
 */
import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { TaskRow, type TaskRowProps, type TaskRowControllerSlice } from '@/components/TaskManager/MainContent/TaskRow'
import type { Task } from '@/types/task'

vi.mock('@/components/task-row-content', () => ({
  TaskRowContent: ({ task }: any) => <div data-testid="row-content">{task.title}</div>,
}))

const task = { id: 'task-1', title: 'Buy milk', completed: false, priority: 0 } as unknown as Task

function controller(overrides: Partial<TaskRowControllerSlice> = {}): TaskRowControllerSlice {
  return {
    selectedTaskId: '',
    activeDragTaskId: null,
    dragTargetTaskId: null,
    dragTargetPosition: null,
    manualSortActive: true,
    manualSortPreviewActive: false,
    effectiveSession: { user: { id: 'user-1' } },
    handleTaskClick: vi.fn(),
    handleToggleTaskComplete: vi.fn(),
    handleCopyTask: vi.fn(),
    handleTaskDragStart: vi.fn(),
    handleTaskDragHover: vi.fn(),
    handleTaskDragLeaveTask: vi.fn(),
    handleTaskDragEnd: vi.fn(),
    handleUpdateTask: vi.fn(),
    taskDisplayMode: 'list',
    ...overrides,
  } as unknown as TaskRowControllerSlice
}

function props(overrides: Partial<TaskRowProps> = {}): TaskRowProps {
  return {
    task,
    controller: controller(),
    isMobile: true,
    isTouchManualSort: true,
    dragCapability: { touchDrag: true, html5Drag: false },
    draggingTaskMetrics: null,
    registerTaskRow: () => () => {},
    taskMeasurementsRef: { current: new Map() },
    renderManualPlaceholderRow: (key: string) => <div key={key} data-testid="placeholder" />,
    setDraggingTaskMetrics: vi.fn(),
    startMobileDrag: vi.fn(),
    ...overrides,
  } as TaskRowProps
}

/** A row whose height has not settled: every measurement differs from the last. */
function unsettledHeights() {
  let n = 0
  return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    n += 1
    const height = n % 2 === 0 ? 44 : 45
    return { x: 0, y: 0, top: 0, left: 0, right: 320, bottom: height, width: 320, height, toJSON: () => ({}) } as DOMRect
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('TaskRow measures itself without a render loop (React #185, 2026-10-04)', () => {
  it('survives a tap while its height is still settling, under manual sort', () => {
    unsettledHeights()
    const base = props()
    const { rerender, getByTestId } = render(<TaskRow {...base} />)

    // The tap: selection moves to this row, which re-renders it.
    expect(() =>
      act(() => {
        rerender(<TaskRow {...base} controller={controller({ selectedTaskId: 'task-1' })} />)
      }),
    ).not.toThrow()
    expect(getByTestId('row-content').textContent).toBe('Buy milk')
  })

  it('still gives the mobile grab handle a height on first render under manual sort', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 320, bottom: 60, width: 320, height: 60, toJSON: () => ({}),
    } as DOMRect)
    const { container } = render(<TaskRow {...props()} />)
    // Task ed1d85ba: the grabber is half the row height (min 24) — it must not render without one.
    const grabber = Array.from(container.querySelectorAll<HTMLElement>('div')).find(el => el.style.width === '20%')
    expect(grabber?.style.height).toBe('30px')
  })
})
