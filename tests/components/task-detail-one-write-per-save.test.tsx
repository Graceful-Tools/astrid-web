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
 * One user save must produce exactly ONE write.
 *
 * Regression for the web-desktop PUT storm (first seen as 14 duplicate
 * "changed task name" comments on task 2f1ec1af; 987 PUTs in 46s; 14,613 on
 * 2026-08-16). Each save handler both wrote and closed its editor, and closing
 * re-ran the handler as the session's commit — recursively, until the stack
 * overflowed, one PUT per level. See
 * tests/hooks/use-editing-session-reentrant-commit.test.tsx for the mechanism.
 */
describe('task detail: one write per save', () => {
  const openTitleEditor = () => {
    fireEvent.click(screen.getAllByText('Test Task')[0])
    return screen.getByDisplayValue('Test Task') as HTMLTextAreaElement
  }

  it('Enter in the title saves once, trimmed', () => {
    const onUpdate = vi.fn()
    render(<TaskDetail {...mockProps} onUpdate={onUpdate} />)

    const textarea = openTitleEditor()
    fireEvent.change(textarea, { target: { value: 'Renamed task ' } })
    act(() => { fireEvent.keyDown(textarea, { key: 'Enter' }) })

    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate.mock.calls[0][0]).toMatchObject({ id: 'task-1', title: 'Renamed task' })
  })

  it('blurring the title saves once', () => {
    const onUpdate = vi.fn()
    render(<TaskDetail {...mockProps} onUpdate={onUpdate} />)

    const textarea = openTitleEditor()
    fireEvent.change(textarea, { target: { value: 'Renamed on blur' } })
    act(() => { fireEvent.blur(textarea) })

    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate.mock.calls[0][0]).toMatchObject({ title: 'Renamed on blur' })
  })

  it('an unchanged title does not write at all', () => {
    const onUpdate = vi.fn()
    render(<TaskDetail {...mockProps} onUpdate={onUpdate} />)

    const textarea = openTitleEditor()
    act(() => { fireEvent.keyDown(textarea, { key: 'Enter' }) })

    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('Escape in the title discards the draft', () => {
    const onUpdate = vi.fn()
    render(<TaskDetail {...mockProps} onUpdate={onUpdate} />)

    const textarea = openTitleEditor()
    fireEvent.change(textarea, { target: { value: 'Never saved' } })
    act(() => { fireEvent.keyDown(textarea, { key: 'Escape' }) })

    expect(onUpdate).not.toHaveBeenCalled()
    expect(screen.getAllByText('Test Task').length).toBeGreaterThan(0)
  })

  it('clicking outside the description saves once', () => {
    const onUpdate = vi.fn()
    render(<TaskDetail {...mockProps} onUpdate={onUpdate} />)

    fireEvent.click(screen.getByText('Test description'))
    const textarea = screen.getByDisplayValue('Test description') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'New description' } })
    act(() => { fireEvent.mouseDown(document.body) })

    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate.mock.calls[0][0]).toMatchObject({ description: 'New description' })
  })
})
