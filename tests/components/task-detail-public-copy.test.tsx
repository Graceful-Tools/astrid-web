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

const publicList = { ...mockList, privacy: 'PUBLIC' as const }
const publicTask = { ...mockTask, lists: [publicList] }

/**
 * Selectors, verified against the rendered DOM rather than assumed:
 * TaskLeadingControl's unassigned state is role=button/aria-label="Unassigned";
 * PublicTaskCopyButton is a div carrying a lucide-copy icon (it has no role or
 * accessible name of its own — noted on the task, not fixed here).
 */
const leadingControl = () => screen.queryByRole('button', { name: /unassigned/i })
const copyControl = () => document.querySelector('.lucide-copy')

describe('TaskDetail public-task leading control (task 72cb4a13)', () => {
  it('CHARACTERIZATION: an editable public task keeps the completion control', () => {
    // Not changing this. A user who CAN edit a public task still completes it.
    render(<TaskDetail {...mockProps} task={publicTask} />)
    expect(leadingControl()).toBeTruthy()
    expect(copyControl()).toBeFalsy()
  })

  it('a read-only public task offers copy-to-my-list instead of completion', () => {
    // task-detail-viewonly renders PublicTaskCopyButton in place of the leading
    // control when isPublicListTask(task). TaskDetail never did, so converging
    // the two without this would take away the only action a viewer of a public
    // task has. This is the real gap — NOT read-only field rendering, which
    // TaskFieldEditors already handles correctly.
    render(<TaskDetail {...mockProps} task={publicTask} readOnly />)
    expect(copyControl()).toBeTruthy()
    expect(leadingControl()).toBeFalsy()
  })

  it('a read-only PRIVATE task keeps the completion control, not copy', () => {
    // The public check gates this, not readOnly alone.
    render(<TaskDetail {...mockProps} readOnly />)
    expect(leadingControl()).toBeTruthy()
    expect(copyControl()).toBeFalsy()
  })
})
