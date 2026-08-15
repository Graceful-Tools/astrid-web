import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TaskDetail } from '@/components/task-detail'
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

describe('TaskDetail canComment (task 72cb4a13)', () => {
  const commentBar = () => document.querySelector('textarea, [data-testid="comment-input-bar"]')

  it('shows the comment input by default', () => {
    render(<TaskDetail {...mockProps} />)
    expect(commentBar()).toBeTruthy()
  })

  it('CHARACTERIZATION: readOnly hides the comment input today', () => {
    // This is the conflation this task exists to unpick. It is LIVE, not dead
    // code: project-status-board.tsx passes readOnly={!canEdit}, so a member
    // who can view but not edit a task on the board gets no comment box —
    // while the same user reaches one through task-detail-viewonly, which
    // deliberately separates the two (readOnly={!canComment} on CommentSection).
    //
    // Pinned here so the widening below is provably a no-op. Flipping this
    // behaviour is a separate, visible change.
    render(<TaskDetail {...mockProps} readOnly />)
    expect(commentBar()).toBeFalsy()
  })

  it('canComment defaults to !readOnly, so existing callers are unaffected', () => {
    const { unmount } = render(<TaskDetail {...mockProps} readOnly />)
    expect(commentBar()).toBeFalsy()
    unmount()

    render(<TaskDetail {...mockProps} />)
    expect(commentBar()).toBeTruthy()
  })

  it('canComment can be granted independently of readOnly', () => {
    // The point of the widening: a caller can say "cannot edit, may comment",
    // which is exactly what the status board should eventually pass.
    render(<TaskDetail {...mockProps} readOnly canComment />)
    expect(commentBar()).toBeTruthy()
  })

  it('canComment={false} withholds the input even when editing is allowed', () => {
    render(<TaskDetail {...mockProps} canComment={false} />)
    expect(commentBar()).toBeFalsy()
  })
})
