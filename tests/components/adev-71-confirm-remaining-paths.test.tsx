/**
 * @vitest-environment jsdom
 */

/**
 * ADEV-71: completing a task that is not yours asks first — on the paths
 * ADEV-56 (#862) left completing silently.
 *
 * ADEV-56 gated the options sheet's Complete, the leading control's direct
 * tap and the `x` shortcut. These still finished someone else's (or nobody's)
 * task without a word:
 *
 *   1. a subtask's checkbox in task details — judged by the SUBTASK's
 *      assignee, not the parent's;
 *   2. Complete on a reminder;
 *   3. choosing Done in a status picker (the options sheet's board state on a
 *      list row and on both boards);
 *   4. dragging a card onto Done — and on cancel the card stays where it was.
 *
 * Plus the wrinkle in the sheet: it judged by the `assignee` OBJECT, so your
 * own task whose `assignee` had not loaded asked as though it were nobody's.
 *
 * Every path routes through `useCompletionConfirmation` and the one rule,
 * `completionNeedsConfirmation`. Reopening never asks; your own task never asks.
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import type { Task, TaskList } from '@/types/task'

vi.mock('@/lib/i18n/client', () => ({
  useTranslations: () => ({
    t: (key: string, replacements?: Record<string, string>) =>
      replacements ? `${key} ${Object.values(replacements).join(' ')}`.trim() : key,
    tArray: () => [],
    locale: 'en',
    messages: null,
  }),
}))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPut: vi.fn() }))
vi.mock('@/lib/api', () => api)

import { TaskDetailSubtasksSection } from '@/components/task-detail/TaskDetailSubtasksSection'
import { AstridReminderPopover } from '@/components/astrid-reminder-popover'
import { PriorityAssigneePicker } from '@/components/priority-assignee-picker'
import { ProjectStatusBoard } from '@/components/project-status-board'
import { ProjectBoard } from '@/components/projects/ProjectBoard'
import { TaskRow, type TaskRowProps, type TaskRowControllerSlice } from '@/components/TaskManager/MainContent/TaskRow'
import { getProjectBoardColumns, VIRTUAL_DONE_COLUMN_ID } from '@/lib/project-status'

// The row loads the options sheet lazily (ADEV-71); render the real sheet synchronously here,
// since these tests are about what it offers, not when its chunk arrives.
vi.mock('@/components/TaskManager/lazy-panels', async importOriginal => ({
  ...(await importOriginal<typeof import('@/components/TaskManager/lazy-panels')>()),
  LazyPriorityAssigneePicker: (await import('@/components/priority-assignee-picker')).PriorityAssigneePicker,
}))


const ME = 'user-me'
const THEM = 'user-them'

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ users: [], listIds: null }) }) as never
  api.apiGet.mockResolvedValue({ ok: true, json: async () => ({ listIds: null }) })
})

const confirmTitle = () => screen.queryByText('tasks.confirmCompleteTitle')
const accept = () => fireEvent.click(screen.getByRole('button', { name: 'common.complete' }))
const cancel = () => fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }))

function boardList(): TaskList {
  return {
    id: 'board-list',
    name: 'Launch',
    color: '#000',
    ownerId: ME,
    privacy: 'PRIVATE',
    listType: 'regular',
    projectId: 'project-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as TaskList
}

function boardTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Ship the launch',
    completed: false,
    priority: 0,
    repeating: 'never',
    statusRole: 'doing',
    assigneeId: null,
    assignee: null,
    lists: [boardList()],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as Task
}

describe('ADEV-71 path 1: a subtask checkbox in task details', () => {
  const child = (assigneeId: string | null, completed = false) =>
    ({ id: 'sub-1', title: 'Order washer', completed, assigneeId }) as unknown as Task

  it("asks before completing someone else's subtask, and completes on accept", () => {
    const onToggleComplete = vi.fn()
    render(<TaskDetailSubtasksSection subtasks={[child(THEM)]} currentUserId={ME} onToggleComplete={onToggleComplete} />)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Order washer' }))
    expect(onToggleComplete).not.toHaveBeenCalled()
    expect(confirmTitle()).toBeTruthy()

    accept()
    expect(onToggleComplete).toHaveBeenCalledWith('sub-1')
  })

  it('asks for an unassigned subtask, and cancel completes nothing', () => {
    const onToggleComplete = vi.fn()
    render(<TaskDetailSubtasksSection subtasks={[child(null)]} currentUserId={ME} onToggleComplete={onToggleComplete} />)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Order washer' }))
    expect(screen.getByText('tasks.confirmCompleteUnassigned')).toBeTruthy()
    cancel()
    expect(onToggleComplete).not.toHaveBeenCalled()
  })

  it('completes your own subtask at once, and reopens any subtask at once', () => {
    const onToggleComplete = vi.fn()
    render(
      <TaskDetailSubtasksSection
        subtasks={[child(ME), { ...child(THEM, true), id: 'sub-2', title: 'Done already' } as Task]}
        currentUserId={ME}
        onToggleComplete={onToggleComplete}
      />,
    )

    fireEvent.click(screen.getByRole('checkbox', { name: 'Order washer' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Done already' }))
    expect(onToggleComplete).toHaveBeenCalledWith('sub-1')
    expect(onToggleComplete).toHaveBeenCalledWith('sub-2')
    expect(confirmTitle()).toBeNull()
  })
})

describe('ADEV-71 path 2: Complete on an in-app reminder', () => {
  const me = { id: ME, name: 'Me', email: 'me@example.com' } as never
  const reminderTask = (assigneeId: string | null) =>
    ({ id: 'task-r', title: 'Call the plumber', completed: false, priority: 0, repeating: 'never', assigneeId, lists: [] }) as unknown as Task

  it('asks before completing an unassigned task from its reminder', () => {
    const onComplete = vi.fn()
    const onDismiss = vi.fn()
    render(<AstridReminderPopover task={reminderTask(null)} currentUser={me} onComplete={onComplete} onSnooze={vi.fn()} onDismiss={onDismiss} />)

    fireEvent.click(screen.getByRole('button', { name: /reminders\.ui\.complete/ }))
    expect(onComplete).not.toHaveBeenCalled()
    expect(confirmTitle()).toBeTruthy()

    accept()
    expect(onComplete).toHaveBeenCalledWith('task-r')
    expect(onDismiss).toHaveBeenCalled()
  })

  it('completes your own task from its reminder without asking', () => {
    const onComplete = vi.fn()
    render(<AstridReminderPopover task={reminderTask(ME)} currentUser={me} onComplete={onComplete} onSnooze={vi.fn()} onDismiss={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /reminders\.ui\.complete/ }))
    expect(onComplete).toHaveBeenCalledWith('task-r')
    expect(confirmTitle()).toBeNull()
  })
})

describe('ADEV-71 path 3: choosing Done in a status picker', () => {
  function makeController(overrides: Partial<TaskRowControllerSlice> = {}): TaskRowControllerSlice {
    return {
      selectedTaskId: '',
      activeDragTaskId: null,
      dragTargetTaskId: null,
      dragTargetPosition: null,
      manualSortActive: false,
      manualSortPreviewActive: false,
      effectiveSession: { user: { id: ME } },
      handleTaskClick: vi.fn(),
      handleToggleTaskComplete: vi.fn(),
      handleCopyTask: vi.fn(),
      handleTaskDragStart: vi.fn(),
      handleTaskDragHover: vi.fn(),
      handleTaskDragLeaveTask: vi.fn(),
      handleTaskDragEnd: vi.fn(),
      handleUpdateTask: vi.fn(),
      ...overrides,
    } as unknown as TaskRowControllerSlice
  }

  function renderRow(task: Task, controller: TaskRowControllerSlice) {
    const props = {
      task,
      controller,
      isMobile: false,
      isTouchManualSort: false,
      dragCapability: { touchDrag: false, html5Drag: true },
      draggingTaskMetrics: null,
      registerTaskRow: () => () => {},
      taskMeasurementsRef: { current: new Map() },
      renderManualPlaceholderRow: () => null,
      setDraggingTaskMetrics: () => {},
      startMobileDrag: () => {},
      board: { projectId: 'project-1', lists: [boardList()], columns: getProjectBoardColumns([]) },
    } as unknown as TaskRowProps
    return render(<TaskRow {...props} />)
  }

  function chooseDoneFromTheRow(container: HTMLElement) {
    fireEvent.click(container.querySelector('[class*="cursor-pointer"]') as Element)
    const group = screen.getByRole('group', { name: 'tasks.boardState' })
    fireEvent.click(within(group).getByRole('button', { name: 'Done' }))
  }

  it('a list row: Done on an unassigned task asks, and cancel moves nothing', () => {
    const controller = makeController()
    const { container } = renderRow(boardTask(), controller)

    chooseDoneFromTheRow(container)
    expect(controller.handleUpdateTask).not.toHaveBeenCalled()
    expect(confirmTitle()).toBeTruthy()

    cancel()
    expect(controller.handleUpdateTask).not.toHaveBeenCalled()
  })

  it('a list row: Done on an unassigned task completes once accepted', () => {
    const controller = makeController()
    const { container } = renderRow(boardTask(), controller)

    chooseDoneFromTheRow(container)
    accept()
    const updated = (controller.handleUpdateTask as Mock).mock.calls[0][0]
    expect(updated.completed).toBe(true)
  })

  it('a list row: a non-Done column never asks', () => {
    const controller = makeController()
    const { container } = renderRow(boardTask(), controller)

    fireEvent.click(container.querySelector('[class*="cursor-pointer"]') as Element)
    fireEvent.click(within(screen.getByRole('group', { name: 'tasks.boardState' })).getByRole('button', { name: 'Ready' }))
    expect(controller.handleUpdateTask).toHaveBeenCalledTimes(1)
    expect(confirmTitle()).toBeNull()
  })

  it("the list board's sheet: Done on someone else's card asks first", () => {
    const onUpdateTask = vi.fn()
    const task = boardTask({ assigneeId: THEM, assignee: { id: THEM, name: 'Sam' } as never })
    render(
      <ProjectStatusBoard
        allTasks={[task]}
        lists={[boardList()]}
        selectedListId="board-list"
        currentUser={{ id: ME } as never}
        onUpdateTask={onUpdateTask}
        onCreateTask={async () => null}
      />,
    )

    // Someone else's card opens the options sheet (AWTD-877); its board
    // state offers Done.
    fireEvent.click(within(screen.getByTestId('status-card-task-1')).getByRole('button', { name: 'tasks.taskOptions' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'tasks.boardState' })).getByRole('button', { name: 'Done' }))

    expect(onUpdateTask).not.toHaveBeenCalled()
    expect(screen.getByText('tasks.confirmCompleteAssigned Sam')).toBeTruthy()
  })
})

describe('ADEV-71 path 4: dragging a card onto Done', () => {
  const renderStatusBoard = (task: Task, onUpdateTask = vi.fn()) => {
    render(
      <ProjectStatusBoard
        allTasks={[task]}
        lists={[boardList()]}
        selectedListId="board-list"
        currentUser={{ id: ME } as never}
        onUpdateTask={onUpdateTask}
        onCreateTask={async () => null}
      />,
    )
    return onUpdateTask
  }
  const dropOn = (testId: string, taskId = 'task-1') =>
    fireEvent.drop(screen.getByTestId(testId), { dataTransfer: { types: ['text/plain'], getData: () => taskId } })

  it('list board: dropping an unassigned card on Done asks; cancel leaves it in its column', () => {
    const onUpdateTask = renderStatusBoard(boardTask())

    dropOn('status-column-done')
    expect(confirmTitle()).toBeTruthy()
    cancel()

    expect(onUpdateTask).not.toHaveBeenCalled()
    expect(within(screen.getByTestId('status-column-doing')).getByText('Ship the launch')).toBeTruthy()
    expect(within(screen.getByTestId('status-column-done')).queryByText('Ship the launch')).toBeNull()
  })

  it('list board: accepting completes the dragged card', () => {
    const onUpdateTask = renderStatusBoard(boardTask())

    dropOn('status-column-done')
    accept()
    expect(onUpdateTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'task-1', completed: true }))
  })

  it('list board: your own card goes to Done without asking; other columns never ask', () => {
    const onUpdateTask = renderStatusBoard(boardTask({ assigneeId: ME }))
    dropOn('status-column-done')
    expect(confirmTitle()).toBeNull()
    expect(onUpdateTask).toHaveBeenCalledWith(expect.objectContaining({ completed: true }))
  })

  it('list board: an unassigned card dragged to Ready never asks', () => {
    const onUpdateTask = renderStatusBoard(boardTask())
    dropOn('status-column-ready')
    expect(confirmTitle()).toBeNull()
    expect(onUpdateTask).toHaveBeenCalledWith(expect.objectContaining({ statusRole: 'ready' }))
  })

  it("project board: dropping someone else's card on Done asks; cancel moves nothing", async () => {
    const onUpdateTask = vi.fn()
    const task = boardTask({ assigneeId: THEM })
    render(
      <ProjectBoard
        projectId="project-1"
        projectName="Launch"
        lists={[boardList()]}
        allTasks={[task]}
        currentUser={{ id: ME } as never}
        onUpdateTask={onUpdateTask}
        onCreateTask={async () => null}
      />,
    )
    const cell = await screen.findByTestId(`project-board-cell-board-list-${VIRTUAL_DONE_COLUMN_ID}`)
    fireEvent.drop(cell, { dataTransfer: { types: ['text/plain'], getData: () => 'task-1' } })

    expect(onUpdateTask).not.toHaveBeenCalled()
    expect(confirmTitle()).toBeTruthy()
    cancel()
    expect(onUpdateTask).not.toHaveBeenCalled()

    fireEvent.drop(cell, { dataTransfer: { types: ['text/plain'], getData: () => 'task-1' } })
    accept()
    expect(onUpdateTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'task-1', completed: true }))
  })
})

describe('ADEV-71: the sheet decides by assigneeId, not the loaded assignee', () => {
  it('your own task with no `assignee` loaded completes without asking', () => {
    const onToggleComplete = vi.fn()
    render(
      <PriorityAssigneePicker
        isOpen
        onClose={vi.fn()}
        onSelect={vi.fn()}
        selectedPriority={0}
        selectedAssignee={null}
        assigneeId={ME}
        availableUsers={[]}
        currentUserId={ME}
        completed={false}
        onToggleComplete={onToggleComplete}
      />,
    )

    fireEvent.click(screen.getByTestId('task-options-complete'))
    expect(onToggleComplete).toHaveBeenCalledTimes(1)
    expect(confirmTitle()).toBeNull()
  })

  it("someone else's task with no `assignee` loaded still asks, as assigned", () => {
    const onToggleComplete = vi.fn()
    render(
      <PriorityAssigneePicker
        isOpen
        onClose={vi.fn()}
        onSelect={vi.fn()}
        selectedPriority={0}
        selectedAssignee={null}
        assigneeId={THEM}
        availableUsers={[]}
        currentUserId={ME}
        completed={false}
        onToggleComplete={onToggleComplete}
      />,
    )

    // The sheet opens on the question (ADEV-71's two-step flow), as assigned, not as nobody's.
    expect(confirmTitle()).not.toBeNull()
    expect(screen.queryByText('tasks.confirmCompleteUnassigned')).toBeNull()
  })
})
