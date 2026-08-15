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

/**
 * Read-only must actually be read-only (task 72cb4a13).
 *
 * Every other field in TaskFieldEditors gates its click behind `!readOnly` —
 * when, time, assignee, lists, description all wrap in a div whose onClick
 * checks it. PriorityPicker was rendered as a bare interactive component with
 * onChange={handleSavePriority} and no gate at all, so priority stayed fully
 * editable in read-only mode.
 *
 * That is reachable in production: project-status-board renders
 * <TaskDetail readOnly={!canEdit} />, so a member who cannot edit a task could
 * still change its priority from the board.
 */

describe('TaskDetail readOnly priority (task 72cb4a13)', () => {
  const priorityButtons = () =>
    Array.from(document.querySelectorAll('button')).filter(b =>
      /^(○|!+)$/.test((b.textContent || '').trim()),
    ) as HTMLButtonElement[]

  it('does not save a priority change when readOnly', () => {
    const onUpdate = vi.fn()
    render(<TaskDetail {...mockProps} onUpdate={onUpdate} readOnly />)

    const buttons = priorityButtons()
    expect(buttons.length).toBeGreaterThan(0)
    buttons.forEach(b => fireEvent.click(b))

    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('marks the priority controls disabled rather than merely inert', () => {
    // A control that silently swallows clicks still invites them. Disabling is
    // what tells the user, and the assistive tree, that it is not available.
    render(<TaskDetail {...mockProps} readOnly />)
    expect(priorityButtons().every(b => b.disabled)).toBe(true)
  })

  it('DELIBERATE: completion stays available to a read-only viewer', () => {
    // Not a bug, and I nearly "fixed" it. task-detail-viewonly — the canonical
    // read-only surface — wires the same control to handleToggleComplete,
    // which calls onUpdate. Checking off a shared task is not editing it, and
    // TaskLeadingControl's own doc says tapping any of the three marks
    // completes the task. Pinned so the next reader does not mistake this for
    // the priority escape above; the two look identical from the outside.
    const onUpdate = vi.fn()
    render(<TaskDetail {...mockProps} onUpdate={onUpdate} readOnly />)

    const leading = screen.getByRole('button', { name: /unassigned/i })
    fireEvent.click(leading)

    expect(onUpdate).toHaveBeenCalled()
  })

  it('still saves a priority change when editable', () => {
    const onUpdate = vi.fn()
    render(<TaskDetail {...mockProps} onUpdate={onUpdate} />)

    const buttons = priorityButtons()
    expect(buttons.some(b => b.disabled)).toBe(false)
    fireEvent.click(buttons[buttons.length - 1])
    expect(onUpdate).toHaveBeenCalled()
  })
})
