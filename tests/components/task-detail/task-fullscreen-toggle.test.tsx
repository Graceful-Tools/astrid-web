/**
 * @vitest-environment jsdom
 */

/**
 * Task 0ea0b818 — "expand task details to full screen then drop back to
 * normal size, on ALL screen sizes."
 *
 * The feature already existed, but its visibility was gated on a CSS width
 * breakpoint (`hidden cols2:inline-flex`, cols2 = 910px) while the pane it
 * belongs to is chosen from the JS column count in lib/layout-detection.ts.
 * Those two disagree on iPad portrait: `getLayoutType()` returns
 * `tablet-2-column` for any iPad regardless of width, and iPad portrait is
 * ~768–834 CSS px — so the floating windowed pane rendered with no way to
 * expand it.
 *
 * jsdom does not evaluate media queries, so a test that merely renders the
 * button cannot catch a breakpoint gate. These tests assert on the class
 * list itself, which is the thing that was wrong.
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

describe('TaskHeader full-screen toggle (task 0ea0b818)', () => {
  it('renders the toggle whenever a handler is supplied', () => {
    renderHeader({ onClose: vi.fn(), onToggleFullScreen: vi.fn(), fullScreen: false })
    expect(screen.getByLabelText('Full screen')).toBeInTheDocument()
  })

  it('is NOT hidden behind a viewport-width breakpoint', () => {
    // The regression: `hidden cols2:inline-flex` hid the control on every
    // 2-column layout narrower than 910px — iPad portrait — even though the
    // windowed pane it expands was rendering there.
    renderHeader({ onClose: vi.fn(), onToggleFullScreen: vi.fn(), fullScreen: false })
    const button = screen.getByLabelText('Full screen')
    expect(button.className).not.toMatch(/\bhidden\b/)
    expect(button.className).not.toMatch(/cols2:/)
  })

  it('swaps to an exit affordance once expanded, so it can drop back to normal', () => {
    renderHeader({ onClose: vi.fn(), onToggleFullScreen: vi.fn(), fullScreen: true })
    expect(screen.getByLabelText('Exit full screen')).toBeInTheDocument()
    expect(screen.queryByLabelText('Full screen')).not.toBeInTheDocument()
  })

  it('calls back on click in both directions', async () => {
    const onToggleFullScreen = vi.fn()
    const u = userEvent.setup()

    const { unmount } = renderHeader({ onClose: vi.fn(), onToggleFullScreen, fullScreen: false })
    await u.click(screen.getByLabelText('Full screen'))
    expect(onToggleFullScreen).toHaveBeenCalledTimes(1)
    unmount()

    renderHeader({ onClose: vi.fn(), onToggleFullScreen, fullScreen: true })
    await u.click(screen.getByLabelText('Exit full screen'))
    expect(onToggleFullScreen).toHaveBeenCalledTimes(2)
  })

  it('omits the toggle entirely when no handler is supplied', () => {
    // How the phone pane opts out: it is already full screen, so expanding it
    // is meaningless. That decision belongs to whoever renders the pane, not
    // to a media query.
    renderHeader({ onClose: vi.fn() })
    expect(screen.queryByLabelText('Full screen')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Exit full screen')).not.toBeInTheDocument()
  })
})
