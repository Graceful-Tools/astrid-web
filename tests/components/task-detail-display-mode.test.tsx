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
 * Task details follow the display mode (task ffa5bbb5).
 *
 * Jon, on list/basic mode: "we need separate rows in task details in all
 * interfaces on board and list view for Priority and assigned." Today they
 * share ONE row — labelled "Priority", with the assignee sitting beside the
 * picker — so this is a real change, not something already satisfied.
 *
 * And on project mode: "we compact the task details so priority and assignee
 * and complete/mark as incomplete are accessed by tapping on the checkbox."
 * Compacting means those rows LEAVE the panel; the leading control already
 * opens the popover that carries them (slice 3).
 *
 * THE PUBLIC-LIST CASE is the trap in splitting this row. A public task shows
 * "Created by" with its creator INSTEAD of an assignee, and hides the priority
 * picker entirely — so a naive split into "Priority" + "Assignee" would invent
 * an assignee row for a task that has no assignee concept and drop the creator.
 */

/**
 * Rows labelled `label`.
 *
 * TaskFieldRow puts the label on `aria-label` when the row has an ICON and
 * renders it as visible text otherwise — Priority and Lists take the first
 * path, so a text-only query finds neither. Both are checked here because
 * which path a row takes is a styling decision, not the thing under test.
 */
function rowsLabelled(label: string) {
  return [
    ...Array.from(document.querySelectorAll(`[aria-label="${label}"]`)),
    ...Array.from(document.querySelectorAll('*')).filter(
      el => el.children.length === 0 && (el.textContent || '').trim() === label,
    ),
  ]
}

describe('list mode gives priority and assignee their own rows (task ffa5bbb5)', () => {
  const rowLabel = (label: string) => rowsLabelled(label)

  it('renders a Priority row and a separate Assignee row', () => {
    render(<TaskDetail {...mockProps} displayMode="list" />)
    expect(rowLabel('Priority').length, 'no Priority row').toBeGreaterThan(0)
    expect(rowLabel('Assignee').length, 'assignee still shares the priority row').toBeGreaterThan(0)
  })

  it('defaults to list mode when no mode is given', () => {
    // Every existing call site omits the prop.
    render(<TaskDetail {...mockProps} />)
    expect(rowLabel('Priority').length).toBeGreaterThan(0)
    expect(rowLabel('Assignee').length).toBeGreaterThan(0)
  })

  it('still shows the priority picker', () => {
    render(<TaskDetail {...mockProps} displayMode="list" />)
    const buttons = Array.from(document.querySelectorAll('button')).filter(b =>
      /^(○|!+)$/.test((b.textContent || '').trim()),
    )
    expect(buttons.length).toBeGreaterThan(0)
  })
})

describe('project mode compacts them out of the panel (task ffa5bbb5)', () => {
  const rowLabel = (label: string) => rowsLabelled(label)

  it('drops both rows', () => {
    render(<TaskDetail {...mockProps} displayMode="project" />)
    expect(rowLabel('Priority').length, 'priority row survived compaction').toBe(0)
    expect(rowLabel('Assignee').length, 'assignee row survived compaction').toBe(0)
  })

  it('drops the priority picker with them', () => {
    // The row could be hidden while the control leaked out elsewhere.
    render(<TaskDetail {...mockProps} displayMode="project" />)
    const buttons = Array.from(document.querySelectorAll('button')).filter(b =>
      /^(○|!+)$/.test((b.textContent || '').trim()),
    )
    expect(buttons.length).toBe(0)
  })

  it('keeps the rest of the panel', () => {
    // Compact means priority and assignee move, not that the panel empties.
    render(<TaskDetail {...mockProps} displayMode="project" />)
    expect(rowLabel('Lists').length).toBeGreaterThan(0)
    expect(rowLabel('Description').length).toBeGreaterThan(0)
  })
})

describe('a public task shows neither row (task ffa5bbb5)', () => {
  const rowLabel = (label: string) => rowsLabelled(label)

  it('renders no Priority, Assignee or Created by row', () => {
    // NOT what the code reads like. The combined row branched on
    // isPublicListTask to show "Created by" instead of an assignee — but the
    // whole block sits behind `!shouldHidePriority`, and
    // shouldHideTaskPriority() *returns* isPublicListTask(). The two are the
    // same predicate, so the "Created by" branch has never been reachable.
    //
    // Asserting the behaviour that actually ships rather than the behaviour the
    // markup implies. The branch is preserved as-is by the split — deleting
    // dead code is a separate change from moving live code, and doing both at
    // once would make this diff impossible to review.
    const publicList = { ...mockList, privacy: 'PUBLIC' }
    const publicTask = {
      ...mockTask,
      lists: [publicList],
      creator: { id: 'user-9', name: 'Pat', email: 'pat@example.com', image: null },
    }
    render(
      <TaskDetail
        {...mockProps}
        task={publicTask as never}
        availableLists={[publicList] as never}
        displayMode="list"
      />,
    )
    expect(rowLabel('Priority').length).toBe(0)
    expect(rowLabel('Assignee').length, 'invented an assignee row for a public task').toBe(0)
    expect(rowLabel('Created by').length, 'the dead branch became reachable').toBe(0)
  })
})
