/**
 * @vitest-environment jsdom
 */

/**
 * A board's task, seen in LIST view: tapping the leading control offers the
 * status picker (task 036ef139).
 *
 * The rule and the mark are covered by task-leading-control-board.test.tsx;
 * what is pinned here is the WIRING, which is where this can go wrong quietly:
 *
 *   - the buttons come from `getProjectBoardColumns` — the board's own helper —
 *     so the board's CUSTOM states appear. TaskRow previously built its columns
 *     from `boardColumnsFor(null)`, which is inbox + the three defaults + done
 *     and knows nothing about a board's custom column. Offering a list of
 *     states that disagrees with the board the row belongs to is worse than
 *     offering none.
 *   - selection routes through `resolveProjectColumnMove`, the same function
 *     drag-and-drop uses, so a state set from the row and a card dragged into a
 *     column cannot mean different things.
 *   - a row NOT on a board still completes on tap.
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { TaskRow, type TaskRowProps, type TaskRowControllerSlice } from '@/components/TaskManager/MainContent/TaskRow'
import { getBoardRowContext, getProjectBoardColumns } from '@/lib/project-status'
import type { Task, TaskList } from '@/types/task'

vi.mock('@/lib/i18n/client', () => ({ useTranslations: () => ({ t: (k: string) => k }) }))

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ users: [] }) }))
})

const owner = {
  id: 'user-1',
  email: 'owner@example.com',
  name: 'Owner',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
}

function list(overrides: Partial<TaskList> & { id: string; name: string }): TaskList {
  return {
    privacy: 'PRIVATE',
    owner,
    ownerId: owner.id,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as unknown as TaskList
}

const PROJECT_ID = 'project-1'
const boardList = list({ id: 'board-list', name: 'Launch', projectId: PROJECT_ID, listType: 'regular' })
const ready = list({ id: 'ready', name: 'Ready', projectId: null, listType: 'status', statusRole: 'ready', statusOrder: 0 })
const doing = list({ id: 'doing', name: 'Doing', projectId: null, listType: 'status', statusRole: 'doing', statusOrder: 1 })
const waiting = list({ id: 'waiting', name: 'Waiting', projectId: null, listType: 'status', statusRole: 'waiting', statusOrder: 2 })
// A per-project custom column — the thing boardColumnsFor(null) cannot know about.
const blocked = list({ id: 'blocked', name: 'Blocked', projectId: PROJECT_ID, listType: 'status', statusRole: 'blocked', statusOrder: 3 })

const LISTS = [boardList, ready, doing, waiting, blocked]

const task = {
  id: 'task-1',
  title: 'Buy milk',
  completed: false,
  priority: 0,
  repeating: 'never',
  assigneeId: 'user-1',
  lists: [boardList],
} as unknown as Task

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

function makeProps(overrides: Partial<TaskRowProps> = {}): TaskRowProps {
  return {
    task,
    controller: makeController(),
    isMobile: false,
    isTouchManualSort: false,
    draggingTaskMetrics: null,
    registerTaskRow: () => () => {},
    taskMeasurementsRef: { current: new Map() },
    renderManualPlaceholderRow: () => null,
    setDraggingTaskMetrics: () => {},
    startMobileDrag: () => {},
    ...overrides,
  } as TaskRowProps
}

const boardContext = {
  projectId: PROJECT_ID,
  lists: LISTS,
  columns: getProjectBoardColumns(LISTS, PROJECT_ID),
}

function tapTheLeadingControl(container: HTMLElement) {
  const target = container.querySelector('[class*="cursor-pointer"]')
  expect(target, 'the leading control rendered nothing tappable').toBeTruthy()
  fireEvent.click(target as Element)
}

describe('a board list in list view (task 036ef139)', () => {
  it('opens the status picker instead of completing the task', () => {
    const controller = makeController()
    const { container } = render(<TaskRow {...makeProps({ controller, board: boardContext })} />)

    tapTheLeadingControl(container)

    expect(screen.getByRole('group', { name: 'tasks.boardState' })).toBeInTheDocument()
    expect(controller.handleToggleTaskComplete).not.toHaveBeenCalled()
  })

  it("offers the board's own columns, custom states included", () => {
    const { container } = render(<TaskRow {...makeProps({ board: boardContext })} />)
    tapTheLeadingControl(container)

    const group = screen.getByRole('group', { name: 'tasks.boardState' })
    for (const name of ['Inbox', 'Ready', 'Doing', 'Waiting', 'Blocked', 'Done']) {
      expect(within(group).getByRole('button', { name }), `missing the ${name} button`).toBeInTheDocument()
    }
  })

  it('writes the chosen state onto the task', () => {
    const controller = makeController()
    const { container } = render(<TaskRow {...makeProps({ controller, board: boardContext })} />)
    tapTheLeadingControl(container)

    const group = screen.getByRole('group', { name: 'tasks.boardState' })
    fireEvent.click(within(group).getByRole('button', { name: 'Doing' }))

    expect(controller.handleUpdateTask).toHaveBeenCalledTimes(1)
    const updated = (controller.handleUpdateTask as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(updated.statusRole).toBe('doing')
    expect(updated.completed).toBe(false)
    // Routed through resolveProjectColumnMove, so the backing list membership
    // moves with the state exactly as a drag would leave it.
    expect(updated.lists.map((entry: TaskList) => entry.id)).toEqual(['board-list', 'doing'])
  })

  it('marks the task complete when Done is chosen', () => {
    const controller = makeController()
    const { container } = render(<TaskRow {...makeProps({ controller, board: boardContext })} />)
    tapTheLeadingControl(container)

    const group = screen.getByRole('group', { name: 'tasks.boardState' })
    fireEvent.click(within(group).getByRole('button', { name: 'Done' }))

    const updated = (controller.handleUpdateTask as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(updated.completed).toBe(true)
    expect(updated.statusRole).toBeNull()
  })
})

describe('a custom state with no backing list (task 9ddf4a6f)', () => {
  // The population Stage D creates, and the one every board reaches once the
  // `listType: 'status'` rows are dropped: the custom column exists ONLY in
  // `Project.customStates`. The fixtures above cannot catch a picker that
  // ignores the project's states, because their "Blocked" is a legacy status
  // row that renders either way — which is how getBoardRowContext shipped
  // dropping the states without a red test.
  const listsWithoutTheRow = [boardList, ready, doing, waiting]
  const CUSTOM_STATES = [{ role: 'blocked', name: 'Blocked', order: 0 }]

  it("offers the project's custom state, built the way MainContent builds it", () => {
    const board = getBoardRowContext(listsWithoutTheRow, 'board-list', CUSTOM_STATES)
    const { container } = render(<TaskRow {...makeProps({ board: board! })} />)
    tapTheLeadingControl(container)

    const group = screen.getByRole('group', { name: 'tasks.boardState' })
    expect(within(group).getByRole('button', { name: 'Blocked' })).toBeInTheDocument()
  })

  it('writes the custom role onto the task', () => {
    const controller = makeController()
    const board = getBoardRowContext(listsWithoutTheRow, 'board-list', CUSTOM_STATES)
    const { container } = render(<TaskRow {...makeProps({ controller, board: board! })} />)
    tapTheLeadingControl(container)

    const group = screen.getByRole('group', { name: 'tasks.boardState' })
    fireEvent.click(within(group).getByRole('button', { name: 'Blocked' }))

    const updated = (controller.handleUpdateTask as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(updated.statusRole).toBe('blocked')
    // No row backs the state, so there is no status membership to add — the
    // board membership must survive on its own.
    expect(updated.lists.map((entry: TaskList) => entry.id)).toEqual(['board-list'])
  })
})

describe('a list with no board is untouched (task 036ef139)', () => {
  it('completes the task on tap and opens nothing', () => {
    const controller = makeController()
    const { container } = render(<TaskRow {...makeProps({ controller })} />)

    tapTheLeadingControl(container)

    expect(controller.handleToggleTaskComplete).toHaveBeenCalledWith('task-1')
    expect(screen.queryByRole('group', { name: 'tasks.boardState' })).not.toBeInTheDocument()
  })
})
