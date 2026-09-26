/**
 * @vitest-environment jsdom
 */

/**
 * AWTD-1017 — the task id shows in task details when the task is on a project
 * list, and "Copy task id" is in the task menu whenever an id exists.
 *
 * The task payload names its lists without `projectId`, so the row resolves
 * the project from `availableLists` — the case that would otherwise hide the
 * id on every real task.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Task, TaskList, User } from '@/types/task'

const toast = vi.fn()
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }))
vi.mock('@/contexts/feature-flag-context', () => ({
  useFeatureFlags: () => ({ isEnabled: () => true }),
}))

import { TaskDetailIdentifierRow } from '@/components/task-detail/TaskDetailIdentifierRow'
import { TaskActionMenu } from '@/components/task-detail/TaskActionMenu'

const user: User = { id: 'u1', email: 'u@example.com', name: 'U', createdAt: new Date() }

function makeTask(identifier: string | null): Task {
  return {
    id: 't1',
    title: 'Fix repeating rollover',
    identifier,
    lists: [{ id: 'board', name: 'Board', privacy: 'PRIVATE' }],
  } as unknown as Task
}

const boardList = { id: 'board', name: 'Board', projectId: 'p1' } as TaskList
const plainList = { id: 'board', name: 'Board', projectId: null } as TaskList

let writeText: ReturnType<typeof vi.fn>

beforeEach(() => {
  toast.mockReset()
  writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})

describe('TaskDetailIdentifierRow (AWTD-1017)', () => {
  it('shows the id for a task on a project list, resolved via availableLists', () => {
    render(<TaskDetailIdentifierRow task={makeTask('AWTD-12')} availableLists={[boardList]} />)
    expect(screen.getByText('AWTD-12')).toBeTruthy()
  })

  it('renders nothing when the list is not in a project', () => {
    const { container } = render(<TaskDetailIdentifierRow task={makeTask('AWTD-12')} availableLists={[plainList]} />)
    expect(container.textContent).toBe('')
  })

  it('renders nothing when the task has no id', () => {
    const { container } = render(<TaskDetailIdentifierRow task={makeTask(null)} availableLists={[boardList]} />)
    expect(container.textContent).toBe('')
  })

  it('copies the id when clicked', async () => {
    render(<TaskDetailIdentifierRow task={makeTask('AWTD-12')} availableLists={[boardList]} />)
    await userEvent.click(screen.getByText('AWTD-12'))
    expect(writeText).toHaveBeenCalledWith('AWTD-12')
    expect(toast).toHaveBeenCalled()
  })
})

describe('Copy task id in the task menu (AWTD-1017)', () => {
  function renderMenu(task: Task) {
    render(
      <TaskActionMenu
        task={task}
        currentUser={user}
        reminderDebugMode={false}
        onCopy={vi.fn()}
        onShare={vi.fn()}
        onDelete={vi.fn()}
        onTestReminder={vi.fn()}
      />
    )
    return userEvent.click(screen.getByRole('button', { name: 'Task actions' }))
  }

  it('copies the id', async () => {
    await renderMenu(makeTask('AWTD-12'))
    await userEvent.click(await screen.findByText('Copy task id'))
    expect(writeText).toHaveBeenCalledWith('AWTD-12')
  })

  it('is absent when the task has no id', async () => {
    await renderMenu(makeTask(null))
    await screen.findByText('Share')
    expect(screen.queryByText('Copy task id')).toBeNull()
  })
})
