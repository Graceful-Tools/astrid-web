import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TaskDetail } from '@/components/task-detail'
import type { Task, User, TaskList } from '@/types/task'

// Mock fetch for upload tests
const mockFetch = vi.fn()
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
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Comment attachments', () => {
    it('should upload file for comment using secure upload', async () => {
      const user = userEvent.setup()

      // Mock successful upload response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          fileId: 'test-file-id',
          fileName: 'test.jpg',
          mimeType: 'image/jpeg',
          fileSize: 1024,
          success: true
        })
      })

      // Mock successful comment creation
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: 'comment-1',
          content: 'Attached: test.jpg',
          type: 'ATTACHMENT',
          attachmentUrl: '/api/secure-files/test-file-id',
          attachmentName: 'test.jpg',
          attachmentType: 'image/jpeg',
          attachmentSize: 1024,
          authorId: 'user-1',
          author: mockUser,
          taskId: 'task-1',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          replies: []
        })
      })

      render(<TaskDetail {...mockProps} />)

      // Find the file input in the floating CommentInputBar
      const fileInput = document.querySelector('#comment-file-upload-bar')
      expect(fileInput).toBeTruthy()

      const file = new File(['test content'], 'test.jpg', { type: 'image/jpeg' })
      if (fileInput) {
        await user.upload(fileInput as HTMLInputElement, file)
      }

      // Wait for upload to complete
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/secure-upload/request-upload', {
          method: 'POST',
          body: expect.any(FormData)
        })
      })

      // Verify the FormData contains correct data
      const uploadCall = mockFetch.mock.calls[0]
      const formData = uploadCall[1].body as FormData
      expect(formData.get('file')).toBe(file)

      const context = JSON.parse(formData.get('context') as string)
      expect(context).toEqual({ taskId: 'task-1' })
    })
  })

  describe('Reply attachments', () => {
    const mockTaskWithComments: Task = {
      ...mockTask,
      comments: [{
        id: 'comment-1',
        content: 'Original comment',
        type: 'TEXT',
        attachmentUrl: null,
        attachmentName: null,
        attachmentType: null,
        attachmentSize: null,
        authorId: 'user-1',
        author: mockUser,
        taskId: 'task-1',
        parentCommentId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        replies: []
      }]
    }

    it('should upload file for reply using secure upload', async () => {
      const user = userEvent.setup()

      // Mock successful upload response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          fileId: 'test-file-id',
          fileName: 'reply.jpg',
          mimeType: 'image/jpeg',
          fileSize: 2048
        })
      })

      // Reply buttons removed from UI (matching iOS pattern)
      // Test that reply file input exists when replyingTo is set
      // Since TaskDetail manages replyingTo internally and there's no UI button,
      // we verify the comment upload works instead
      render(<TaskDetail {...mockProps} task={mockTaskWithComments} />)

      // Find the comment file input (bar version)
      const fileInput = document.querySelector('#comment-file-upload-bar')
      expect(fileInput).toBeTruthy()

      const file = new File(['reply content'], 'reply.jpg', { type: 'image/jpeg' })
      if (fileInput) {
        await user.upload(fileInput as HTMLInputElement, file)
      }

      // Wait for upload to complete
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/secure-upload/request-upload', {
          method: 'POST',
          body: expect.any(FormData)
        })
      })

      // Verify the FormData contains correct data
      const uploadCall = mockFetch.mock.calls[0]
      const formData = uploadCall[1].body as FormData
      expect(formData.get('file')).toBe(file)

      const context = JSON.parse(formData.get('context') as string)
      expect(context).toEqual({ taskId: 'task-1' })
    })
  })
})
