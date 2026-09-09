/**
 * @vitest-environment jsdom
 */

/**
 * AWTD-877, at the surface Jon first reported the older half of it on.
 *
 * Task 43bcc76c: "in task details cannot complete tasks when user in list mode.
 * Tapping on profile should show popover with confirmation to complete." The
 * answer then was a confirm-on-tap that TaskHeader alone asked for, via a
 * `surface="detail"` prop. AWTD-877 replaced it: the tap opens the options
 * sheet on every surface, and the sheet's Complete button confirms.
 *
 * So the wiring this file protects has moved up one level. TaskHeader must hand
 * the tap to `onOpenOptions`, and task-detail.tsx must SUPPLY that handler for
 * someone else's task even in list mode. The bug was never in the control
 * alone — it was details having no completion affordance at all — and it comes
 * back the moment either half is dropped while the other stays green.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { readFileSync } from 'fs'
import { join } from 'path'
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

describe('completing someone else\'s task from task details (AWTD-877)', () => {
  it('offers a way to complete it at all — in list mode there was none', () => {
    const { container } = renderHeader({ onOpenOptions: vi.fn() })

    expect(container.querySelector('[class*="cursor-pointer"][role="button"]')).toBeTruthy()
  })

  it('routes the tap to the options sheet rather than completing outright', () => {
    const onToggleComplete = vi.fn()
    const onOpenOptions = vi.fn()
    const { container } = renderHeader({ onToggleComplete, onOpenOptions })

    fireEvent.click(container.querySelector('[class*="cursor-pointer"][role="button"]')!)

    expect(onOpenOptions).toHaveBeenCalledTimes(1)
    expect(onToggleComplete).not.toHaveBeenCalled()
  })
})

describe('task-detail supplies that sheet in list mode (AWTD-877)', () => {
  // Source-level, like project-board-display-mode.test.ts: rendering the whole
  // panel would drag in its data layer to prove one prop. Without these two the
  // header above is handed no handler, its avatar goes inert, and details is
  // back to the dead end task 43bcc76c was filed about — with every other test
  // still green, which is exactly why this assertion exists.
  const src = readFileSync(join(process.cwd(), 'components/task-detail.tsx'), 'utf8')

  it('decides whether the task is someone else\'s', () => {
    expect(src).toMatch(/isSomeoneElsesTask\(\{/)
  })

  it('opens the sheet for compact mode OR someone else\'s task', () => {
    expect(src).toMatch(/onOpenOptions=\{compactTaskDetail \|\| taskIsSomeoneElses/)
    expect(src).toMatch(/\(compactTaskDetail \|\| taskIsSomeoneElses\) && \(/)
  })
})
