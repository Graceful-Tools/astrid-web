/**
 * @vitest-environment jsdom
 */

/**
 * Regression tests for task cc76307c — remove the "Task Details" header bar and
 * move the action menu inline with the title row, in both the 2-column and
 * 3-column layouts.
 *
 * The bar was not just a label: it also owned the mobile back button. Deleting
 * it naively would have stranded narrow-viewport users with no way back to the
 * list, so that is pinned here explicitly.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Task, User } from '@/types/task'

vi.mock('@/contexts/feature-flag-context', () => ({
  useFeatureFlags: () => ({ isEnabled: () => true }),
}))

import { TaskHeader } from '@/components/task-detail/TaskHeader'

const user: User = { id: 'u1', email: 'u@example.com', name: 'U', createdAt: new Date() }

const task = {
  id: 't1',
  title: 'Fix repeating rollover',
  description: '',
  completed: false,
  priority: 0,
  repeating: 'never',
  lists: [{ id: 'l1', name: 'List', privacy: 'PRIVATE' }],
  comments: [],
  attachments: [],
  creator: user,
  creatorId: 'u1',
  createdAt: new Date(),
  updatedAt: new Date(),
  isPrivate: true,
  repeatFrom: 'COMPLETION_DATE',
  occurrenceCount: 0,
} as unknown as Task

function renderHeader(overrides: Record<string, unknown> = {}) {
  return render(
    <TaskHeader
      task={task}
      currentUser={user}
      tempCompleted={false}
      tempTitle={task.title}
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
    />
  )
}

describe('TaskHeader layout (cc76307c)', () => {
  it('does not render a "Task Details" header bar', () => {
    renderHeader({ onClose: vi.fn() })
    expect(screen.queryByText('Task Details')).not.toBeInTheDocument()
  })

  it('renders no "Task Details" bar in compact mode either', () => {
    renderHeader({ onClose: vi.fn(), compact: true })
    expect(screen.queryByText('Task Details')).not.toBeInTheDocument()
  })

  it('still renders the title', () => {
    renderHeader({ onClose: vi.fn() })
    expect(screen.getByText('Fix repeating rollover')).toBeInTheDocument()
  })

  it('KEEPS the mobile back button that the removed bar used to own', () => {
    // The bar was the only route back to the list on a narrow viewport.
    // Deleting it without rehoming this button would strand those users.
    renderHeader({ onClose: vi.fn() })
    expect(screen.getByLabelText('Back to list')).toBeInTheDocument()
  })

  it('omits the back button when there is nothing to go back to', () => {
    renderHeader({})
    expect(screen.queryByLabelText('Back to list')).not.toBeInTheDocument()
  })

  it('uses a collapse chevron instead of back in compact mode', () => {
    // An inline/board panel collapses in place; it does not navigate.
    renderHeader({ onClose: vi.fn(), compact: true })
    expect(screen.getByLabelText('Collapse task')).toBeInTheDocument()
    expect(screen.queryByLabelText('Back to list')).not.toBeInTheDocument()
  })

  it('renders the action menu in both layouts', () => {
    const { unmount } = renderHeader({ onClose: vi.fn() })
    expect(screen.getAllByRole('button').length).toBeGreaterThan(0)
    unmount()
    renderHeader({ onClose: vi.fn(), compact: true })
    expect(screen.getAllByRole('button').length).toBeGreaterThan(0)
  })
})

/**
 * Task dcbbb0fa item 3 — full-screen task details.
 */
describe('full-screen toggle (dcbbb0fa)', () => {
  it('offers a full-screen control when the parent supports it', () => {
    renderHeader({ onClose: vi.fn(), onToggleFullScreen: vi.fn(), fullScreen: false })
    expect(screen.getByLabelText('Full screen')).toBeInTheDocument()
  })

  it('flips to an exit control once full screen', () => {
    renderHeader({ onClose: vi.fn(), onToggleFullScreen: vi.fn(), fullScreen: true })
    expect(screen.getByLabelText('Exit full screen')).toBeInTheDocument()
    expect(screen.queryByLabelText('Full screen')).not.toBeInTheDocument()
  })

  it('offers it on the compact/inline panel too (task 52bf1efb)', () => {
    // This used to assert the opposite — the compact header omitted the control
    // on the reasoning that an inline panel is a peek. Jon asked for it on the
    // board card, where the expanded card IS the only way to read the task, so
    // the compact header now carries the toggle above its collapse chevron.
    renderHeader({ onClose: vi.fn(), compact: true, onToggleFullScreen: vi.fn() })
    expect(screen.getByLabelText('Full screen')).toBeInTheDocument()
  })

  it('still omits it on the compact panel when no handler is passed', () => {
    // The opt-in is the gate, in both header layouts.
    renderHeader({ onClose: vi.fn(), compact: true })
    expect(screen.queryByLabelText('Full screen')).not.toBeInTheDocument()
  })

  it('omits it entirely when the parent passes no handler', () => {
    renderHeader({ onClose: vi.fn() })
    expect(screen.queryByLabelText('Full screen')).not.toBeInTheDocument()
  })

  it('calls back when toggled', () => {
    const onToggle = vi.fn()
    renderHeader({ onClose: vi.fn(), onToggleFullScreen: onToggle, fullScreen: false })
    screen.getByLabelText('Full screen').click()
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('keeps the action menu above the full-screen panel (AWTD-753)', async () => {
    const user = userEvent.setup()
    renderHeader({ onClose: vi.fn(), onToggleFullScreen: vi.fn(), fullScreen: true })

    const trigger = document.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')
    expect(trigger).not.toBeNull()
    await user.click(trigger!)

    expect(screen.getByRole('menu').className).toMatch(/(?:^|\s)z-\[(?:6[1-9]|[7-9]\d|\d{3,})\](?:\s|$)/)
  })
})
