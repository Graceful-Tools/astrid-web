/**
 * @vitest-environment jsdom
 */
/**
 * AWTD-1637 (iOS/Mac AITD-650): a one-tap × beside the assignee picker in task
 * details unassigns. Shown only while the task holds someone; hidden read-only.
 */
import { describe, it, expect, vi } from 'vitest'
import { buildTask, buildUser } from '../fixtures/domain'
import { row } from '../fixtures/prisma-rows'
import { buildTaskList } from '../fixtures/domain'
import { render, screen, fireEvent } from '@testing-library/react'
import { TaskDetail } from '@/components/task-detail'
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


const assignedTask: Task = { ...mockTask, assigneeId: 'user-1', assignee: mockUser, assigneeIds: ['user-1'] }

describe('task details unassign × (AWTD-1637)', () => {
  it('is absent while nobody holds the task', () => {
    render(<TaskDetail {...mockProps} />)
    expect(screen.queryByTestId('unassign-button')).toBeNull()
  })

  it('one tap clears every assignee and does not open the picker', () => {
    const onUpdate = vi.fn()
    render(<TaskDetail {...mockProps} task={assignedTask} onUpdate={onUpdate} />)
    const x = screen.getByRole('button', { name: 'Unassign' })
    fireEvent.click(x)
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate.mock.calls[0][0]).toMatchObject({ id: 'task-1', assignee: null, assigneeId: null, assigneeIds: [] })
    // The row's own click (open the picker) did not also fire.
    expect(screen.queryByPlaceholderText(/search/i)).toBeNull()
  })

  it('is absent read-only', () => {
    render(<TaskDetail {...mockProps} task={assignedTask} readOnly />)
    expect(screen.queryByTestId('unassign-button')).toBeNull()
  })
})
