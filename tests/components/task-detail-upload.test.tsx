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

describe('TaskDetail Upload Functionality', () => {
  it('should render file upload input in comment section', () => {
    render(<TaskDetail {...mockProps} />)
    // File input should be present for attachment uploads
    const fileInput = document.querySelector('input[type="file"]')
    expect(fileInput).toBeTruthy()
  })
})
