/**
 * @vitest-environment jsdom
 */

/**
 * Task 43bcc76c, at the surface Jon actually reported it on.
 *
 * "in task details cannot complete tasks when user in list mode. Tapping on
 * profile should show popover with confirmation to complete."
 *
 * tests/components/task-leading-control-confirm.tsx pins the control's own
 * behaviour, but the control only asks for confirmation when it is told it is
 * on the detail surface. This file is what stops that wiring from being dropped
 * out of TaskHeader while every other test stays green — the bug was never in
 * the control alone, it was in details having no completion affordance.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Task, User } from '@/types/task'

vi.mock('@/contexts/feature-flag-context', () => ({
  useFeatureFlags: () => ({ isEnabled: () => true }),
}))

import { TaskHeader } from '@/components/task-detail/TaskHeader'

const me: User = { id: 'u1', email: 'me@example.com', name: 'Me', createdAt: new Date() }
const them = { id: 'u2', email: 'sam@example.com', name: 'Sam Smith', image: null }

const theirTask = {
  id: 't1',
  title: 'Ship the thing',
  description: '',
  completed: false,
  priority: 0,
  repeating: 'never',
  assigneeId: them.id,
  assignee: them,
  lists: [{ id: 'l1', name: 'List', privacy: 'PRIVATE' }],
  comments: [],
  attachments: [],
  creator: me,
  creatorId: me.id,
  createdAt: new Date(),
  updatedAt: new Date(),
  isPrivate: true,
  repeatFrom: 'COMPLETION_DATE',
  occurrenceCount: 0,
} as unknown as Task

function renderHeader(overrides: Record<string, unknown> = {}) {
  return render(
    <TaskHeader
      task={theirTask}
      currentUser={me}
      displayMode="list"
      tempCompleted={false}
      tempTitle={theirTask.title}
      editingTitle={false}
      setTempTitle={vi.fn()}
      setEditingTitle={vi.fn()}
      onToggleComplete={vi.fn()}
      onSaveTitle={vi.fn()}
      onCancelTitle={vi.fn()}
      reminderDebugMode={false}
      onCopy={vi.fn()}
      onShare={vi.fn()}
      onDelete={vi.fn()}
      onTestReminder={vi.fn()}
      {...overrides}
    />,
  )
}

describe('completing someone else\'s task from task details (task 43bcc76c)', () => {
  it('offers a way to complete it at all — in list mode there was none', () => {
    const { container } = renderHeader()

    expect(container.querySelector('[class*="cursor-pointer"][role="button"]')).toBeTruthy()
  })

  it('confirms before completing, and completes when confirmed', () => {
    const onToggleComplete = vi.fn()
    const { container } = renderHeader({ onToggleComplete })

    fireEvent.click(container.querySelector('[class*="cursor-pointer"][role="button"]')!)
    expect(onToggleComplete).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Complete' }))
    expect(onToggleComplete).toHaveBeenCalledTimes(1)
  })

  it('names the assignee in the confirmation', () => {
    const { container } = renderHeader()

    fireEvent.click(container.querySelector('[class*="cursor-pointer"][role="button"]')!)

    expect(screen.getByText(/Sam Smith/)).toBeInTheDocument()
  })
})
