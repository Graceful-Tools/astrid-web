/**
 * TaskDetail leaves no focus timer running after it unmounts (2026-11-09).
 *
 * The focus-out handler starts a 100ms timer that reads `document`, and the unmount cleanup
 * cleared only the LATEST one. Two focus-outs inside 100ms left the first running past unmount;
 * in CI it fired after the test environment was gone — "ReferenceError: document is not
 * defined" at components/task-detail.tsx — and failed the production deploy's quality gate
 * for d75dec3c although all 11,728 tests passed.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { buildTask, buildUser } from '../fixtures/domain'
import { row } from '../fixtures/prisma-rows'
import { buildTaskList } from '../fixtures/domain'
import { render } from '@testing-library/react'
import { TaskDetail } from '@/components/task-detail'
import { needsScrollIntoViewHandling } from '@/lib/layout-detection'
import type { Task, User, TaskList } from '@/types/task'

// Mock fetch for upload tests
// Default implementation returns empty JSON for any unhandled requests
// (e.g., /api/user/ai-assistant-settings called by CommentSection useEffect)
const mockFetch = vi.fn().mockResolvedValue(row({
  ok: true,
  json: () => Promise.resolve({})
}))
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

// Mock new SSE subscription hooks
vi.mock('@/hooks/use-sse-subscription', () => ({
  useSSESubscription: vi.fn(() => ({
    isConnected: true
  })),
  useSSEConnectionStatus: vi.fn(() => ({
    isConnected: true,
    connectionAttempts: 0,
    lastEventTime: Date.now(),
    subscriptionCount: 1
  })),
  useTaskSSEEvents: vi.fn(() => ({
    isConnected: true
  })),
  useCodingWorkflowSSEEvents: vi.fn(() => ({
    isConnected: true
  }))
}))

vi.mock('@/contexts/settings-context', () => ({
  useSettings: () => ({ reminderDebugMode: false })
}))

vi.mock('@/lib/reminder-manager', () => ({
  useReminders: () => ({ triggerManualReminder: vi.fn() })
}))

// Create test data
const mockUser: User = buildUser({
  id: 'user-1',
  name: 'Test User',
  email: 'test@example.com',
  image: null,
  createdAt: new Date(),
})

const mockList: TaskList = buildTaskList({
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
})

const mockTask: Task = buildTask({
  id: 'task-1',
  title: 'Test Task',
  description: 'Test description',
  completed: false,
  priority: 1,
  dueDateTime: null,
  repeating: 'never',
  creatorId: 'user-1',
  assigneeId: null,
  assignee: null,
  isPrivate: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  lists: [mockList],
  comments: [],
  attachments: []
})

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

describe('TaskDetail focus timers', () => {
  afterEach(() => {
    vi.useRealTimers()
    document.body.classList.remove('form-element-focused')
  })

  it('a burst of focus-outs leaves nothing running after unmount', () => {
    const { unmount } = render(<TaskDetail {...mockProps} />)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    document.dispatchEvent(new FocusEvent('focusout'))
    document.dispatchEvent(new FocusEvent('focusout'))
    unmount()

    // A timer still running would strip this class 100ms from now.
    document.body.classList.add('form-element-focused')
    vi.advanceTimersByTime(500)
    expect(document.body.classList.contains('form-element-focused')).toBe(true)
  })

  it('a burst of focus-ins on iOS/iPad scrolls nothing after unmount', () => {
    vi.mocked(needsScrollIntoViewHandling).mockReturnValue(true)
    const { unmount } = render(<TaskDetail {...mockProps} />)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const input = document.createElement('input')
    input.scrollIntoView = vi.fn()
    document.body.appendChild(input)
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    unmount()

    vi.advanceTimersByTime(500)
    expect(input.scrollIntoView).not.toHaveBeenCalled()
    input.remove()
    vi.mocked(needsScrollIntoViewHandling).mockReturnValue(false)
  })
})
