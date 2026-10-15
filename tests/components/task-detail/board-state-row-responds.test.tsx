/**
 * @vitest-environment jsdom
 */

/**
 * AWTD-1253 — "Status buttons in task details are unresponsive in list view."
 *
 * Diagnostic first, regression second. The board-state row renders in LIST
 * mode and not in project mode: `showsTaskDetailProjectState` is
 * `!usesCompactTaskDetail(displayMode) && isInProject && !isReadOnly`, and
 * `usesCompactTaskDetail` means `mode === 'project'` (lib/task-display-mode.ts).
 * So list view is exactly where these buttons are expected to work, which is
 * what the report is about.
 *
 * These assert the contract the row owes its parent: a click resolves the move
 * through the board's own planner and hands the result to `onUpdate`. If this
 * passes, the row is innocent and the fault is downstream in persistence —
 * which is worth knowing before changing any UI.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Task, TaskList } from '@/types/task'

vi.mock('@/lib/i18n/client', () => ({
  useTranslations: () => ({ t: (key: string) => key }),
}))

// The row reads its columns through the shared cached hook; a board with the
// default columns is what an ordinary project list has.
vi.mock('@/hooks/useProjectCustomStates', () => ({
  useProjectCustomStates: () => undefined,
}))

import { TaskDetailBoardStateRow } from '@/components/task-detail/TaskDetailBoardStateRow'

const projectList = { id: 'board', name: 'Board', projectId: 'p1' } as TaskList

function task(over: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: 'A task on a project list',
    completed: false,
    statusRole: null,
    lists: [{ id: 'board', name: 'Board', privacy: 'PRIVATE' }],
    ...over,
  } as unknown as Task
}

describe('the board-state row responds in list view (AWTD-1253)', () => {
  const onUpdate = vi.fn()
  beforeEach(() => onUpdate.mockClear())

  const renderRow = (displayMode: string | null) =>
    render(
      <TaskDetailBoardStateRow
        task={task()}
        availableLists={[projectList]}
        displayMode={displayMode}
        readOnly={false}
        onUpdate={onUpdate}
      />,
    )

  it('renders its chips in list mode — this is the mode the report is about', () => {
    renderRow('list')
    expect(screen.getByRole('group', { name: 'tasks.boardState' })).toBeTruthy()
    expect(screen.getByTestId('task-detail-board-state-ready')).toBeTruthy()
  })

  it('hands a move to onUpdate when a chip is clicked', async () => {
    renderRow('list')
    await userEvent.click(screen.getByTestId('task-detail-board-state-ready'))

    expect(onUpdate).toHaveBeenCalledTimes(1)
    const updated = onUpdate.mock.calls[0][0] as Task
    expect(updated.statusRole).toBe('ready')
    expect(updated.completed).toBe(false)
  })

  it('keeps the task on its list rather than dropping memberships', () => {
    // resolveProjectColumnMove strips the stale `listType: 'status'` membership
    // and returns the ids to keep. Mapping those back through availableLists is
    // the row's job, and getting it wrong would silently remove the task from
    // the board it was just filed on.
    renderRow('list')
    return userEvent.click(screen.getByTestId('task-detail-board-state-ready')).then(() => {
      const updated = onUpdate.mock.calls[0][0] as Task
      expect((updated.lists ?? []).map(list => list.id)).toContain('board')
    })
  })

  it('renders nothing in project mode, where the checkbox popover owns status', () => {
    const { container } = renderRow('project')
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing for a read-only viewer', () => {
    const { container } = render(
      <TaskDetailBoardStateRow
        task={task()}
        availableLists={[projectList]}
        displayMode="list"
        readOnly
        onUpdate={onUpdate}
      />,
    )
    expect(container.firstChild).toBeNull()
  })
})

describe('the click is REFLECTED, which is what "unresponsive" means to a user (AWTD-1253)', () => {
  const onUpdate = vi.fn()

  it('marks the chip for the task’s current role as pressed', () => {
    // The write can succeed and still look dead: the pane re-renders from the
    // updated task, so if the role does not map back to a chip, nothing
    // highlights and the buttons read as unresponsive.
    render(
      <TaskDetailBoardStateRow
        task={task({ statusRole: 'ready' } as Partial<Task>)}
        availableLists={[projectList]}
        displayMode="list"
        readOnly={false}
        onUpdate={onUpdate}
      />,
    )
    const ready = screen.getByTestId('task-detail-board-state-ready')
    expect(ready.getAttribute('aria-pressed')).toBe('true')
  })

  it('and does not leave Inbox pressed once a role is set', () => {
    render(
      <TaskDetailBoardStateRow
        task={task({ statusRole: 'doing' } as Partial<Task>)}
        availableLists={[projectList]}
        displayMode="list"
        readOnly={false}
        onUpdate={onUpdate}
      />,
    )
    expect(screen.getByTestId('task-detail-board-state-doing').getAttribute('aria-pressed')).toBe('true')
    const inbox = screen.queryByTestId('task-detail-board-state-inbox')
    if (inbox) expect(inbox.getAttribute('aria-pressed')).toBe('false')
  })
})
