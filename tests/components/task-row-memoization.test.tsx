/**
 * @vitest-environment jsdom
 */

/**
 * RED for task ed1d85ba-2368-4397-b99c-e40a11c4b8d4, bullet 4.
 *
 * `quickTaskInput` lives in useTaskManagerModals, high above the list, so every
 * character typed into the add-task box re-renders TaskManagerView, MainContent
 * and — because nothing stopped it — every TaskRow beneath them. At the
 * virtualization threshold that is 150 full row renders per keystroke, and
 * virtualization is off entirely in manual-sort mode, so the longest lists are
 * the ones it never covered.
 *
 * Two things have to hold for a keystroke to stop reaching the rows: TaskRow
 * has to compare its props, and MainContent has to stop handing it a freshly
 * built controller object on every render (it assembled one as a bare literal,
 * which made any memo boundary inert).
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { renderHook } from '@testing-library/react'
import { TaskRow, type TaskRowProps, type TaskRowControllerSlice } from '@/components/TaskManager/MainContent/TaskRow'
import { useTaskRowController } from '@/hooks/task-manager/useTaskRowController'
import { TASK_DISPLAY_MODES } from '@/lib/task-display-mode'
import type { Task } from '@/types/task'

const rowContentRenders = vi.fn()
vi.mock('@/components/task-row-content', () => ({
  TaskRowContent: ({ task }: any) => {
    rowContentRenders(task.id)
    return <div data-testid="row-content">{task.title}</div>
  },
}))

const task = { id: 'task-1', title: 'Buy milk', completed: false, priority: 0 } as unknown as Task

function makeController(overrides: Partial<TaskRowControllerSlice> = {}): TaskRowControllerSlice {
  return {
    selectedTaskId: '',
    activeDragTaskId: null,
    dragTargetTaskId: null,
    dragTargetPosition: null,
    manualSortActive: false,
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

/** Props held outside the component so a parent re-render reuses them. */
function stableProps(overrides: Partial<TaskRowProps> = {}): TaskRowProps {
  return {
    task,
    controller: makeController(),
    isMobile: false,
    isTouchManualSort: false,
    dragCapability: { touchDrag: false, html5Drag: true },
    draggingTaskMetrics: null,
    registerTaskRow: () => () => {},
    taskMeasurementsRef: { current: new Map() },
    renderManualPlaceholderRow: (key: string) => <div key={key} data-testid="placeholder" />,
    setDraggingTaskMetrics: vi.fn(),
    startMobileDrag: vi.fn(),
    ...overrides,
  } as TaskRowProps
}

beforeEach(() => {
  rowContentRenders.mockClear()
})

describe('TaskRow does not re-render for a keystroke elsewhere (task ed1d85ba)', () => {
  it('skips a parent re-render that changed none of its props', () => {
    const props = stableProps()
    let bumpParent: (() => void) | undefined

    function Parent() {
      // Stands in for `quickTaskInput`, which lives above MainContent and
      // changes on every character typed into the add-task box.
      const [keystrokes, setKeystrokes] = React.useState('')
      bumpParent = () => setKeystrokes(k => `${k}a`)
      return (
        <div>
          <span>{keystrokes}</span>
          <TaskRow {...props} />
        </div>
      )
    }

    render(<Parent />)
    expect(rowContentRenders).toHaveBeenCalledTimes(1)

    act(() => bumpParent?.())
    act(() => bumpParent?.())

    expect(rowContentRenders).toHaveBeenCalledTimes(1)
  })

  it('still re-renders when its own task changes', () => {
    const { rerender } = render(<TaskRow {...stableProps()} />)
    expect(rowContentRenders).toHaveBeenCalledTimes(1)

    rerender(<TaskRow {...stableProps({ task: { ...task, title: 'Buy oat milk' } as Task })} />)

    expect(rowContentRenders).toHaveBeenCalledTimes(2)
  })

  it('still re-renders when the selection moves to it', () => {
    const props = stableProps()
    const { rerender } = render(<TaskRow {...props} />)
    expect(rowContentRenders).toHaveBeenCalledTimes(1)

    rerender(<TaskRow {...props} controller={makeController({ selectedTaskId: 'task-1' })} />)

    expect(rowContentRenders).toHaveBeenCalledTimes(2)
  })
})

describe('the controller bundle rows receive is stable (task ed1d85ba)', () => {
  const input = {
    selectedTaskId: '',
    activeDragTaskId: null,
    dragTargetTaskId: null,
    dragTargetPosition: null,
    manualSortActive: false,
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
  }

  it('returns the same object when nothing a row cares about changed', () => {
    const { result, rerender } = renderHook((p: typeof input) => useTaskRowController(p), {
      initialProps: input,
    })
    const first = result.current

    // A keystroke re-renders MainContent with all the same row inputs.
    rerender({ ...input })
    rerender({ ...input })

    expect(result.current).toBe(first)
  })

  it('returns a new object when something a row renders from changed', () => {
    const { result, rerender } = renderHook((p: typeof input) => useTaskRowController(p), {
      initialProps: input,
    })
    const first = result.current

    rerender({ ...input, selectedTaskId: 'task-1' })

    expect(result.current).not.toBe(first)
    expect(result.current.selectedTaskId).toBe('task-1')
  })

  it('normalises the display mode rather than passing a bare string down', () => {
    const { result } = renderHook(() =>
      useTaskRowController({ ...input, taskDisplayMode: 'not-a-mode' }),
    )

    // A mode that travelled down a long prop chain must not reach a row as an
    // unrecognised value (task ffa5bbb5) — the reason this was adapted rather
    // than cast when it was a literal.
    expect(TASK_DISPLAY_MODES).toContain(result.current.taskDisplayMode)
  })
})

/**
 * Review follow-up to the memoisation above.
 *
 * The row measures itself on commit, but the manual-sort grab handle, the drop
 * overlay and the origin placeholder are all sized during RENDER from that
 * measurement. Unmemoised, the row picked it up on whatever parent re-render
 * came next — and one always did. Memoised, nothing re-renders it, so the
 * grabber was left with no height and collapsed to its ~4px inner bar.
 */
describe('a memoised row still picks up its own measurement (task ed1d85ba)', () => {
  const ROW_HEIGHT = 96
  let originalGetBoundingClientRect: typeof Element.prototype.getBoundingClientRect

  beforeEach(() => {
    originalGetBoundingClientRect = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function () {
      return { height: ROW_HEIGHT, width: 320, top: 0, left: 0, bottom: ROW_HEIGHT, right: 320, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
    }
  })

  afterEach(() => {
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect
  })

  it('sizes the mobile manual-sort grabber without waiting for a parent render', () => {
    const { container } = render(
      <TaskRow
        {...stableProps({
          isMobile: true,
          isTouchManualSort: true,
          dragCapability: { touchDrag: true, html5Drag: false },
          controller: makeController({ manualSortActive: true }),
          // A fresh map, as a row mounting into a list it has never been in.
          taskMeasurementsRef: { current: new Map() },
        })}
      />,
    )

    const grabber = container.querySelector('[style*="height"]')
    expect(grabber).not.toBeNull()
    expect((grabber as HTMLElement).style.height).toBe(`${Math.max(ROW_HEIGHT / 2, 24)}px`)
  })
})
