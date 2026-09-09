/**
 * @vitest-environment jsdom
 */

/**
 * AWTD-872 — "move expand button on board task view to inside the ... menu.
 * currently it is too cluttered."
 *
 * An expanded board card renders TaskDetail inline, and its COMPACT header
 * stacked three controls vertically inside a 20px gutter: full-screen, collapse,
 * and the "..." menu. Three targets at 20px each, in a column, on a card — the
 * clutter is the stack, not any one of them.
 *
 * Full screen is the one that moves, and it is the right one: collapse is the
 * card's own affordance (it undoes the tap that expanded it) and the menu is
 * where every other secondary action already lives.
 *
 * The ROOMY header is deliberately untouched. It lays the same controls out
 * horizontally in a side pane with room to spare, and task 0ea0b818 is
 * specifically about that button being reachable there — moving it into a menu
 * would undo that fix. `tests/.../task-fullscreen-toggle.test.tsx` still pins it.
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

describe('board card header — expand lives in the menu (AWTD-872)', () => {
  it('shows no standalone full-screen button in the card gutter', () => {
    renderHeader({ compact: true, onClose: vi.fn(), onToggleFullScreen: vi.fn(), fullScreen: false })

    // Nothing in the gutter. Not hidden, not smaller — absent.
    expect(screen.queryByRole('button', { name: 'Full screen' })).not.toBeInTheDocument()
  })

  it('leaves exactly two controls in the gutter: collapse, and the menu', () => {
    // The measurement that matters. Three stacked 20px targets was the
    // complaint, so the count is the assertion — a fix that merely restyled the
    // third button would pass a "looks better" test and fail this one.
    renderHeader({ compact: true, onClose: vi.fn(), onToggleFullScreen: vi.fn(), fullScreen: false })

    const gutter = screen.getByLabelText('Collapse task').parentElement!
    expect(gutter.querySelectorAll('button')).toHaveLength(2)
  })

  it('offers Full screen inside the ... menu instead', async () => {
    const onToggleFullScreen = vi.fn()
    const u = userEvent.setup()
    renderHeader({ compact: true, onClose: vi.fn(), onToggleFullScreen, fullScreen: false })

    await u.click(screen.getByRole('button', { name: 'Task actions' }))
    await u.click(await screen.findByRole('menuitem', { name: /full screen/i }))

    expect(onToggleFullScreen).toHaveBeenCalledTimes(1)
  })

  it('says Exit full screen once expanded, so the menu can drop it back', async () => {
    const u = userEvent.setup()
    renderHeader({ compact: true, onClose: vi.fn(), onToggleFullScreen: vi.fn(), fullScreen: true })

    await u.click(screen.getByRole('button', { name: 'Task actions' }))
    expect(await screen.findByRole('menuitem', { name: /exit full screen/i })).toBeInTheDocument()
  })

  it('omits the menu item when the caller supplies no handler', async () => {
    // The phone pane opts out by passing nothing — it is already full screen.
    // That decision stays with whoever renders the pane.
    const u = userEvent.setup()
    renderHeader({ compact: true, onClose: vi.fn() })

    await u.click(screen.getByRole('button', { name: 'Task actions' }))
    expect(screen.queryByRole('menuitem', { name: /full screen/i })).not.toBeInTheDocument()
  })
})
