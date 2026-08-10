/**
 * REGRESSION TEST — Task 5e997cf9: editing a task scroll-jumps to the bottom of the comments.
 *
 * TaskDetail auto-scrolls the detail pane to the bottom whenever
 * `task.comments.length` grows (components/task-detail.tsx). The intent is
 * "a new comment arrived, show it". But the count is read off a task object
 * that gets REPLACED wholesale on every refresh and every field edit
 * (`handleRefreshComments` -> onLocalUpdate, and ~30 `onUpdate({...task, x})`
 * call sites). When the incoming object carries comments the local copy did
 * not have, the count jumps 0 -> N and the pane scrolls to the bottom —
 * nothing was posted, the array was merely populated.
 *
 * These tests drive the scroll container directly rather than asserting on a
 * replica of the effect: the defect is in the real component's effect wiring,
 * and a hand-rolled copy of that logic would pass no matter what the component
 * does.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { TaskDetail } from '@/components/task-detail'
import type { Task, User, TaskList, Comment } from '@/types/task'
import { ThemeProvider } from '@/contexts/theme-context'
import { SettingsProvider } from '@/contexts/settings-context'

vi.mock('@/hooks/use-sse-subscription', () => ({
  useSSESubscription: vi.fn()
}))

vi.mock('@/hooks/use-coding-assignment-detector', () => ({
  useCodingAssignmentDetector: vi.fn()
}))

vi.mock('@/lib/reminder-manager', () => ({
  useReminders: vi.fn(() => ({
    triggerManualReminder: vi.fn()
  }))
}))

const mockUser: User = {
  id: 'user-1',
  name: 'Test User',
  email: 'test@example.com',
  avatarUrl: null
}

const mockList: TaskList = {
  id: 'list-1',
  name: 'Test List',
  color: '#3b82f6',
  privacy: 'PRIVATE',
  ownerId: 'user-1'
}

function makeComment(id: string): Comment {
  return {
    id,
    content: `Comment ${id}`,
    type: 'TEXT',
    authorId: mockUser.id,
    author: mockUser,
    taskId: 'task-1',
    createdAt: new Date('2026-08-09T12:00:00Z'),
    updatedAt: new Date('2026-08-09T12:00:00Z'),
    replies: []
  } as unknown as Comment
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
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
    ...overrides
  } as Task
}

describe('TaskDetail — scroll jump on edit (task 5e997cf9)', () => {
  let scrollToSpy: ReturnType<typeof vi.fn>
  let originalScrollTo: unknown

  beforeEach(() => {
    // jsdom does not implement scrollTo; the component calls it on the scroll
    // container. Stub it on the prototype so we can observe the call.
    originalScrollTo = (Element.prototype as unknown as { scrollTo?: unknown }).scrollTo
    scrollToSpy = vi.fn()
    ;(Element.prototype as unknown as { scrollTo: unknown }).scrollTo = scrollToSpy

    // The mount effect refreshes comments over the network. Keep it from
    // replacing the task under the test's feet.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  })

  afterEach(() => {
    ;(Element.prototype as unknown as { scrollTo?: unknown }).scrollTo = originalScrollTo
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const renderDetail = (task: Task) =>
    render(
      <ThemeProvider>
        <SettingsProvider>
          <TaskDetail
            task={task}
            currentUser={mockUser}
            availableLists={[mockList]}
            onUpdate={vi.fn()}
            onDelete={vi.fn()}
          />
        </SettingsProvider>
      </ThemeProvider>
    )

  const rerenderDetail = (
    rerender: ReturnType<typeof renderDetail>['rerender'],
    task: Task
  ) =>
    rerender(
      <ThemeProvider>
        <SettingsProvider>
          <TaskDetail
            task={task}
            currentUser={mockUser}
            availableLists={[mockList]}
            onUpdate={vi.fn()}
            onDelete={vi.fn()}
          />
        </SettingsProvider>
      </ThemeProvider>
    )

  // The scroll is fired from a setTimeout(..., 100).
  const settleScrollTimer = async () => {
    await new Promise(resolve => setTimeout(resolve, 200))
  }

  it('does not scroll when an edit replaces the task with one carrying loaded comments', async () => {
    // Opened from the list view: the task object has no comments loaded yet.
    const { rerender } = renderDetail(makeTask({ comments: [] }))
    scrollToSpy.mockClear()

    // The user edits the title. The update response replaces the whole task
    // object, and it carries the comments the local copy never had.
    rerenderDetail(
      rerender,
      makeTask({
        title: 'Edited title',
        comments: [makeComment('c1'), makeComment('c2'), makeComment('c3')]
      })
    )
    await settleScrollTimer()

    expect(scrollToSpy).not.toHaveBeenCalled()
  })

  it('does not scroll when an edit leaves the already-loaded comments unchanged', async () => {
    const comments = [makeComment('c1'), makeComment('c2')]
    const { rerender } = renderDetail(makeTask({ comments }))
    scrollToSpy.mockClear()

    rerenderDetail(rerender, makeTask({ title: 'Edited title', comments }))
    await settleScrollTimer()

    expect(scrollToSpy).not.toHaveBeenCalled()
  })

  it('still scrolls when a comment is appended to an already-loaded thread', async () => {
    // The feature this effect exists for must survive the fix.
    const comments = [makeComment('c1'), makeComment('c2')]
    const { rerender } = renderDetail(makeTask({ comments }))
    scrollToSpy.mockClear()

    rerenderDetail(
      rerender,
      makeTask({ comments: [...comments, makeComment('c3')] })
    )
    await settleScrollTimer()

    expect(scrollToSpy).toHaveBeenCalled()
  })

  it('still scrolls when this client posts the FIRST comment on a task', async () => {
    // The empty-thread guard must not swallow our own optimistic write —
    // otherwise "no comments yet, post one" silently stops scrolling.
    // `buildPendingComments` mints `temp-<nanoid>` ids (lib/comment-posting.ts).
    const { rerender } = renderDetail(makeTask({ comments: [] }))
    scrollToSpy.mockClear()

    rerenderDetail(rerender, makeTask({ comments: [makeComment('temp-abc123')] }))
    await settleScrollTimer()

    expect(scrollToSpy).toHaveBeenCalled()
  })

  it('does not scroll when switching to a different task that has comments', async () => {
    const { rerender } = renderDetail(makeTask({ comments: [makeComment('c1')] }))
    scrollToSpy.mockClear()

    rerenderDetail(
      rerender,
      makeTask({
        id: 'task-2',
        comments: [makeComment('c1'), makeComment('c2'), makeComment('c3')]
      })
    )
    await settleScrollTimer()

    expect(scrollToSpy).not.toHaveBeenCalled()
  })
})
