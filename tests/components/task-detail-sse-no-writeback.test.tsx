import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TaskDetail } from '@/components/task-detail'

// Capture the handler task-detail registers so events can be driven directly.
let sseHandler: ((event: { type: string; data: Record<string, unknown> }) => void) | null = null
//
// NOTE: the harness this file was seeded from carried its OWN no-op mock of
// this module, and vi.mock registrations are hoisted so the LAST one for a
// path wins — it silently swallowed the handler and every assertion below
// passed while driving nothing. The meta test at the bottom exists because of
// that: it fails loudly if the handler stops being captured.
vi.mock('@/hooks/use-sse-subscription', () => ({
  useSSESubscription: (_types: unknown, handler: (e: never) => void) => {
    sseHandler = handler as never
    return { isConnected: true }
  },
  useSSEConnectionStatus: () => ({ isConnected: true, connectionAttempts: 0 }),
  useTaskSSEEvents: () => ({ isConnected: true }),
  useCodingWorkflowSSEEvents: () => ({ isConnected: true }),
}))
import type { Task, User, TaskList } from '@/types/task'

// Mock fetch for upload tests
// Default implementation returns empty JSON for any unhandled requests
// (e.g., /api/user/ai-assistant-settings called by CommentSection useEffect)
const mockFetch = vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({})
})
global.fetch = mockFetch

// Mock layout detection
vi.mock('@/lib/layout-detection', () => ({
  isIPadDevice: vi.fn(() => false),
  shouldPreventAutoFocus: vi.fn(() => false),
  getKeyboardDetectionThreshold: vi.fn(() => 150),
  needsAggressiveKeyboardProtection: vi.fn(() => false),
  shouldIgnoreTouchDuringKeyboard: vi.fn(() => false),
  needsScrollIntoViewHandling: vi.fn(() => false),
  getFocusProtectionThreshold: vi.fn(() => 300),
  needsMobileFormHandling: vi.fn(() => false),
  isMobileDevice: vi.fn(() => false),
  is1ColumnView: vi.fn(() => false)
}))

// Mock next-auth
vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: {
      user: {
        id: 'user-1',
        name: 'Test User',
        email: 'test@example.com'
      }
    },
    status: 'authenticated'
  }),
  getSession: vi.fn(async () => ({
    user: {
      id: 'user-1',
      name: 'Test User',
      email: 'test@example.com'
    }
  }))
}))

// Mock contexts
vi.mock('@/contexts/theme-context', () => ({
  useTheme: () => ({ theme: 'light' })
}))


vi.mock('@/contexts/settings-context', () => ({
  useSettings: () => ({ reminderDebugMode: false })
}))

vi.mock('@/lib/reminder-manager', () => ({
  useReminders: () => ({ triggerManualReminder: vi.fn() })
}))

// Create test data
const mockUser: User = {
  id: 'user-1',
  name: 'Test User',
  email: 'test@example.com',
  image: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  emailVerified: null
}

const mockList: TaskList = {
  id: 'list-1',
  name: 'Test List',
  color: '#3b82f6',
  ownerId: 'user-1',
  privacy: 'PRIVATE',
  admins: [],
  members: [],
  listMembers: [],
  createdAt: new Date(),
  updatedAt: new Date()
}

const mockTask: Task = {
  id: 'task-1',
  title: 'Test Task',
  description: 'Test description',
  completed: false,
  priority: 1,
  when: null,
  dueDateTime: null,
  repeating: 'never',
  repeatingData: null,
  creatorId: 'user-1',
  assigneeId: null,
  assignee: null,
  isPrivate: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  lists: [mockList],
  comments: [],
  attachments: []
}

const mockProps = {
  task: mockTask,
  currentUser: mockUser,
  availableLists: [mockList],
  onUpdate: vi.fn(),
  onDelete: vi.fn(),
  onEdit: vi.fn(),
  onClose: vi.fn(),
  onCopy: vi.fn(),
  onSaveNew: vi.fn(),
  selectedTaskElement: null
}

/**
 * Inbound SSE must not write back to the server (task da325f65).
 *
 * components/task-detail.tsx handled remote changes by calling `onUpdate(...)`
 * — and `onUpdate` is bound to `handleUpdateTask`
 * (components/TaskManagerView.tsx:1040, :1093), which issues
 * `apiPut('/api/v1/tasks/:id')`. So RECEIVING a change caused SENDING one.
 *
 * IT CAN PING-PONG BETWEEN TWO CLIENTS. The only guard returns early when the
 * event's userId matches the current user, which suppresses your own echo and
 * not someone else's:
 *
 *   A edits (userId A) -> B receives, PUTs (server emits userId B)
 *   -> A receives, B != A, PUTs (userId A) -> B receives ... and around.
 *
 * The correct call was already in the file: `onLocalUpdate` (used at :1011 for
 * the comment refresh) updates state without an API call. These cases pin the
 * distinction, because the two props take identical arguments and swapping them
 * back would look like a no-op diff.
 */

describe('inbound SSE does not echo a write back (task da325f65)', () => {
  /**
   * `comments` must be present on the payload.
   *
   * Both echo paths in the task_updated handler sit inside
   * `if (updatedTask.id === currentTask.id && updatedTask.comments)`, so a
   * payload without it reaches neither and the assertions below would pass
   * while proving nothing. An earlier version of this fixture omitted it and
   * did exactly that.
   */
  const remoteEvent = (task: Record<string, unknown>) => ({
    type: 'task_updated',
    data: { userId: 'someone-else', task: { comments: [], ...task } },
  })

  it('a remote task_updated does NOT trigger onUpdate', () => {
    const onUpdate = vi.fn()
    const onLocalUpdate = vi.fn()
    render(<TaskDetail {...mockProps} onUpdate={onUpdate} onLocalUpdate={onLocalUpdate} />)

    act(() => {
      sseHandler?.(remoteEvent({ id: 'task-1', title: 'Renamed elsewhere' }))
    })

    expect(
      onUpdate,
      'receiving a remote change PUT it back to the server — this is the ping-pong',
    ).not.toHaveBeenCalled()
  })

  it('a remote task_updated still applies locally', () => {
    // Not writing back must not become not updating.
    const onLocalUpdate = vi.fn()
    render(<TaskDetail {...mockProps} onUpdate={vi.fn()} onLocalUpdate={onLocalUpdate} />)

    act(() => {
      sseHandler?.(remoteEvent({ id: 'task-1', title: 'Renamed elsewhere' }))
    })

    expect(onLocalUpdate, 'the remote change was dropped entirely').toHaveBeenCalled()
  })

  it('a remote comment_created does NOT trigger onUpdate', () => {
    const onUpdate = vi.fn()
    const onLocalUpdate = vi.fn()
    render(<TaskDetail {...mockProps} onUpdate={onUpdate} onLocalUpdate={onLocalUpdate} />)

    act(() => {
      sseHandler?.({
        type: 'comment_created',
        data: {
          userId: 'someone-else',
          taskId: 'task-1',
          comment: { id: 'c-9', content: 'hello', createdAt: new Date().toISOString() },
        },
      })
    })

    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('still ignores an event echoing the current user', () => {
    // The pre-existing guard must survive the change.
    const onUpdate = vi.fn()
    const onLocalUpdate = vi.fn()
    render(<TaskDetail {...mockProps} onUpdate={onUpdate} onLocalUpdate={onLocalUpdate} />)

    act(() => {
      sseHandler?.({
        type: 'task_updated',
        data: { userId: 'user-1', task: { id: 'task-1', title: 'Mine', comments: [] } },
      })
    })

    expect(onUpdate).not.toHaveBeenCalled()
    expect(onLocalUpdate).not.toHaveBeenCalled()
  })
})

describe('meta: the harness actually drives the component (task da325f65)', () => {
  it('captured the SSE handler', () => {
    render(<TaskDetail {...mockProps} onUpdate={vi.fn()} onLocalUpdate={vi.fn()} />)
    expect(sseHandler, 'useSSESubscription mock never received a handler').toBeTypeOf('function')
  })
})

describe('user edits must STILL reach the server (task da325f65)', () => {
  /**
   * This is the counterweight, and it exists because it was needed.
   *
   * A first attempt at the fix replaced `onUpdate` across the whole component
   * rather than inside the SSE callback, which silently converted every
   * user-initiated save — title, priority, assignee, completion — into a
   * local-only update. Edits would never have reached the server. Every test
   * above still passed, because they only assert what must NOT happen.
   *
   * Completion is the cheapest user edit to drive from the outside, so it
   * stands in for the family.
   */
  it('toggling completion calls onUpdate, not just local state', () => {
    const onUpdate = vi.fn()
    render(<TaskDetail {...mockProps} onUpdate={onUpdate} onLocalUpdate={vi.fn()} />)

    const leading = screen.getByRole('button', { name: /unassigned/i })
    fireEvent.click(leading)

    expect(
      onUpdate,
      'a user edit stopped reaching the server — the SSE fix was applied too widely',
    ).toHaveBeenCalled()
  })
})
