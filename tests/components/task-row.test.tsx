/**
 * @vitest-environment jsdom
 */

/**
 * Task 0a16228c — Stage 20a: extracting the per-task row wrapper (card +
 * drag/drop handlers + manual-sort grab handle) out of MainContent.tsx into
 * components/TaskManager/MainContent/TaskRow.tsx.
 *
 * TaskRowContent (the inner body) is mocked so these tests exercise TaskRow's
 * own wiring: click-to-open, complete/copy callbacks, drag-start metrics, and
 * the mobile manual-sort grabber. No behavior change from the inline version.
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TaskRow, type TaskRowProps, type TaskRowControllerSlice } from '@/components/TaskManager/MainContent/TaskRow'
import type { Task } from '@/types/task'

// Mock the inner body so we can drive its callbacks without its real markup.
vi.mock('@/components/task-row-content', () => ({
  TaskRowContent: ({ task, onToggleComplete, onCopyPublic }: any) => (
    <div data-testid="row-content">
      <span>{task.title}</span>
      <button data-testid="toggle" onClick={onToggleComplete}>toggle</button>
      <button data-testid="copy" onClick={onCopyPublic}>copy</button>
    </div>
  ),
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
    ...overrides,
  } as unknown as TaskRowControllerSlice
}

function makeProps(overrides: Partial<TaskRowProps> = {}): TaskRowProps {
  return {
    task,
    controller: makeController(),
    isMobile: false,
    isTouchManualSort: false,
    getPriorityColor: () => 'gray',
    draggingTaskMetrics: null,
    registerTaskRow: () => () => {},
    taskMeasurementsRef: { current: new Map() },
    renderManualPlaceholderRow: (key) => <div key={key} data-testid="placeholder" />,
    setDraggingTaskMetrics: vi.fn(),
    startMobileDrag: vi.fn(),
    ...overrides,
  }
}

describe('TaskRow (Stage 20a / task 0a16228c)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the row body with a data-task-id wrapper', () => {
    const { container } = render(<TaskRow {...makeProps()} />)
    expect(screen.getByText('Buy milk')).toBeInTheDocument()
    expect(container.querySelector('[data-task-id="task-1"]')).not.toBeNull()
  })

  it('opens the task when the row is clicked', () => {
    const controller = makeController()
    const { container } = render(<TaskRow {...makeProps({ controller })} />)
    const row = container.querySelector('[data-task-id="task-1"]') as HTMLElement
    fireEvent.click(row)
    expect(controller.handleTaskClick).toHaveBeenCalledWith('task-1', row)
  })

  it('wires complete and copy callbacks through to the row id', () => {
    const controller = makeController()
    render(<TaskRow {...makeProps({ controller })} />)
    fireEvent.click(screen.getByTestId('toggle'))
    fireEvent.click(screen.getByTestId('copy'))
    expect(controller.handleToggleTaskComplete).toHaveBeenCalledWith('task-1')
    expect(controller.handleCopyTask).toHaveBeenCalledWith('task-1')
  })

  it('records drag metrics and notifies on drag start (desktop)', () => {
    const controller = makeController()
    const setDraggingTaskMetrics = vi.fn()
    const { container } = render(
      <TaskRow {...makeProps({ controller, setDraggingTaskMetrics })} />
    )
    const row = container.querySelector('[data-task-id="task-1"]') as HTMLElement
    expect(row.getAttribute('draggable')).toBe('true')
    fireEvent.dragStart(row)
    expect(setDraggingTaskMetrics).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-1' })
    )
    expect(controller.handleTaskDragStart).toHaveBeenCalledWith('task-1')
  })

  it('is not native-draggable while touch manual sort is active', () => {
    const { container } = render(
      <TaskRow {...makeProps({ isMobile: true, isTouchManualSort: true })} />
    )
    const row = container.querySelector('[data-task-id="task-1"]') as HTMLElement
    expect(row.getAttribute('draggable')).toBe('false')
  })

  it('starts a mobile drag from the grab handle when manual sort is active', () => {
    const startMobileDrag = vi.fn()
    const controller = makeController({ manualSortActive: true })
    const { container } = render(
      <TaskRow
        {...makeProps({
          isMobile: true,
          isTouchManualSort: true,
          controller,
          startMobileDrag,
        })}
      />
    )
    // The grab handle is the only element with an onTouchStart handler.
    const row = container.querySelector('[data-task-id="task-1"]') as HTMLElement
    const grabber = row.querySelector('.absolute.bottom-0\\.5') as HTMLElement
    expect(grabber).not.toBeNull()
    fireEvent.touchStart(grabber, { touches: [{ identifier: 7, clientX: 0, clientY: 0 }] })
    expect(startMobileDrag).toHaveBeenCalledWith('task-1', 7)
    expect(controller.handleTaskDragStart).toHaveBeenCalledWith('task-1')
  })
})
