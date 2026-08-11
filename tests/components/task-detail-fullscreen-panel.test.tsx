/**
 * Task 0ea0b818 — expand task details to full screen, then drop back to
 * normal size, on ALL screen sizes.
 *
 * Panel-level companion to tests/components/task-detail/task-fullscreen-toggle
 * (which covers the header control). These assert the two things the control
 * is useless without:
 *
 *   1. Whether a pane CAN expand is a decision passed in by whoever renders
 *      it — not inferred from a viewport width. That indirection is the whole
 *      fix: the old `hidden cols2:inline-flex` gate hid the control on iPad
 *      portrait, where the windowed pane does render.
 *   2. Expanding marks the panel with `data-fullscreen`, which is what the
 *      wrapper's CSS keys off to escape its own stacking context.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TaskDetail } from '@/components/task-detail'
import { TaskDetailViewOnly } from '@/components/task-detail-viewonly'
import type { Task, User, TaskList } from '@/types/task'
import { ThemeProvider } from '@/contexts/theme-context'
import { SettingsProvider } from '@/contexts/settings-context'

vi.mock('@/hooks/use-sse-subscription', () => ({
  useSSESubscription: vi.fn(),
}))

vi.mock('@/hooks/use-coding-assignment-detector', () => ({
  useCodingAssignmentDetector: vi.fn(),
}))

vi.mock('@/lib/reminder-manager', () => ({
  useReminders: vi.fn(() => ({ triggerManualReminder: vi.fn() })),
}))

const mockUser: User = {
  id: 'user-1',
  name: 'Test User',
  email: 'test@example.com',
  avatarUrl: null,
} as unknown as User

const mockList: TaskList = {
  id: 'list-1',
  name: 'Test List',
  color: '#3b82f6',
  privacy: 'PRIVATE',
  ownerId: 'user-1',
} as unknown as TaskList

const task = {
  id: 'task-1',
  title: 'Test Task',
  description: '',
  completed: false,
  priority: 0,
  repeating: 'never',
  dueDateTime: null,
  isAllDay: false,
  lists: [mockList],
  comments: [],
  createdAt: new Date().toISOString(),
  userId: 'user-1',
  assigneeId: 'user-1',
} as unknown as Task

beforeEach(() => {
  ;(Element.prototype as unknown as { scrollTo: unknown }).scrollTo = vi.fn()
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function wrap(node: React.ReactElement) {
  return render(
    <ThemeProvider>
      <SettingsProvider>{node}</SettingsProvider>
    </ThemeProvider>,
  )
}

function panel(container: HTMLElement) {
  return container.querySelector('[data-task-detail-panel]') as HTMLElement
}

describe('TaskDetail — expand to full screen (task 0ea0b818)', () => {
  it('offers no toggle when the renderer did not opt in', () => {
    // This is how the phone pane stays out: it already fills the screen, so
    // expanding it means nothing.
    wrap(
      <TaskDetail
        task={task}
        currentUser={mockUser}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.queryByLabelText('Full screen')).not.toBeInTheDocument()
  })

  it('offers the toggle when the renderer opts in', () => {
    wrap(
      <TaskDetail
        task={task}
        currentUser={mockUser}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
        allowFullScreen
      />,
    )
    expect(screen.getByLabelText('Full screen')).toBeInTheDocument()
  })

  it('expands and drops back to normal size', async () => {
    const user = userEvent.setup()
    const { container } = wrap(
      <TaskDetail
        task={task}
        currentUser={mockUser}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
        allowFullScreen
      />,
    )

    expect(panel(container).getAttribute('data-fullscreen')).toBeNull()

    await user.click(screen.getByLabelText('Full screen'))
    expect(panel(container).getAttribute('data-fullscreen')).toBe('true')
    expect(panel(container).className).toContain('task-panel-expanded')

    // "then drop to normal size" — the round trip, not just the expand.
    await user.click(screen.getByLabelText('Exit full screen'))
    expect(panel(container).getAttribute('data-fullscreen')).toBeNull()
    expect(panel(container).className).not.toContain('task-panel-expanded')
  })

  it('does not go full screen with `fixed inset-0` on the panel itself', async () => {
    // THE original bug, found by measuring in a browser rather than reading
    // markup. The old expanded class list ended in `relative`:
    //
    //   `fixed inset-0 z-50 w-full ... relative`
    //
    // Tailwind emits `.relative` AFTER `.fixed` in its stylesheet, so
    // `position: relative` won and the panel never moved — measured at
    // 1440x900 it stayed at 400,128 1030x732 instead of 0,0 1440x900. The
    // control appeared to do nothing on every screen size.
    //
    // The fix puts the geometry on the wrapper (see `.task-panel-desktop:has(
    // [data-fullscreen="true"])` in styles/components.css) so a stray
    // position utility on the panel cannot silently defeat it.
    const user = userEvent.setup()
    const { container } = wrap(
      <TaskDetail
        task={task}
        currentUser={mockUser}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
        allowFullScreen
      />,
    )
    await user.click(screen.getByLabelText('Full screen'))
    expect(panel(container).className).not.toContain('fixed')
    expect(panel(container).className).not.toContain('inset-0')
  })

  it('an inline/board panel never expands, even if asked', () => {
    // Inline panels collapse in place inside a board column; expanding one to
    // cover the viewport would be a different feature.
    wrap(
      <TaskDetail
        task={task}
        currentUser={mockUser}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
        inline
        allowFullScreen
      />,
    )
    expect(screen.queryByLabelText('Full screen')).not.toBeInTheDocument()
  })
})

describe('TaskDetailViewOnly — expand to full screen (task 0ea0b818)', () => {
  it('offers no toggle when the renderer did not opt in', () => {
    wrap(
      <TaskDetailViewOnly
        task={task}
        currentUser={mockUser}
        onUpdate={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.queryByLabelText('Full screen')).not.toBeInTheDocument()
  })

  it('expands and drops back — a task you cannot edit is still one you read', async () => {
    // Read-only had no full-screen support at all before this task, on any
    // screen size.
    const user = userEvent.setup()
    const { container } = wrap(
      <TaskDetailViewOnly
        task={task}
        currentUser={mockUser}
        onUpdate={vi.fn()}
        onClose={vi.fn()}
        allowFullScreen
      />,
    )

    expect(panel(container).getAttribute('data-fullscreen')).toBeNull()

    await user.click(screen.getByLabelText('Full screen'))
    expect(panel(container).getAttribute('data-fullscreen')).toBe('true')
    expect(panel(container).className).toContain('task-panel-expanded')

    await user.click(screen.getByLabelText('Exit full screen'))
    expect(panel(container).getAttribute('data-fullscreen')).toBeNull()
  })
})
