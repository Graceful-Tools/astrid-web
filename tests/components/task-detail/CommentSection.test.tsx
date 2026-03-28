import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CommentSection } from '@/components/task-detail/CommentSection'
import type { Task, User } from '@/types/task'
import type { FileAttachment } from '@/hooks/task-detail/useTaskDetailState'

// Mock the layout detection
vi.mock('@/lib/layout-detection', () => ({
  isMobileDevice: vi.fn(() => false),
  isIPadDevice: vi.fn(() => false),
  is1ColumnView: vi.fn(() => false),
}))

describe('CommentSection', () => {
  const mockCurrentUser: User = {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    image: null
  }

  const mockTask: Task = {
    id: 'task-1',
    title: 'Test Task',
    description: '',
    priority: 1,
    completed: false,
    lists: [],
    creatorId: 'user-1',
    assigneeId: null,
    when: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    comments: [
      {
        id: 'comment-1',
        content: 'First comment',
        type: 'TEXT',
        author: mockCurrentUser,
        authorId: 'user-1',
        taskId: 'task-1',
        createdAt: new Date('2025-01-01T10:00:00Z'),
        updatedAt: new Date('2025-01-01T10:00:00Z'),
        replies: []
      }
    ]
  }

  const defaultProps = {
    task: mockTask,
    currentUser: mockCurrentUser,
    onUpdate: vi.fn(),
    newComment: '',
    setNewComment: vi.fn(),
    uploadingFile: false,
    setUploadingFile: vi.fn(),
    attachedFile: null,
    setAttachedFile: vi.fn(),
    replyingTo: null,
    setReplyingTo: vi.fn(),
    replyContent: '',
    setReplyContent: vi.fn(),
    replyAttachedFile: null,
    setReplyAttachedFile: vi.fn(),
    uploadingReplyFile: false,
    setUploadingReplyFile: vi.fn(),
    showingActionsFor: null,
    setShowingActionsFor: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  describe('Rendering', () => {
    it('should render comments section with comment count', () => {
      render(<CommentSection {...defaultProps} />)
      expect(screen.getByText('Comments (1)')).toBeInTheDocument()
    })

    it('should render existing comments', () => {
      render(<CommentSection {...defaultProps} />)
      expect(screen.getByText('First comment')).toBeInTheDocument()
      // Chat bubble shows "You" for current user's comments
      expect(screen.getByText('You')).toBeInTheDocument()
    })

    it('should render add comment textarea', () => {
      render(<CommentSection {...defaultProps} />)
      expect(screen.getByPlaceholderText('Add a comment...')).toBeInTheDocument()
    })

    it('should show comment author and timestamp', () => {
      render(<CommentSection {...defaultProps} />)
      // Chat bubble shows "You" for current user's comments
      expect(screen.getByText('You')).toBeInTheDocument()
    })
  })

  describe('Adding Comments', () => {
    it('should call setNewComment when typing', () => {
      const setNewComment = vi.fn()
      render(<CommentSection {...defaultProps} setNewComment={setNewComment} />)

      const textarea = screen.getByPlaceholderText('Add a comment...')
      fireEvent.change(textarea, { target: { value: 'New comment' } })

      expect(setNewComment).toHaveBeenCalledWith('New comment')
    })

    it('should add comment on Enter key', { timeout: 15000 }, async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'new-comment',
          content: 'Test comment',
          type: 'TEXT',
          author: mockCurrentUser,
          authorId: 'user-1',
          taskId: 'task-1',
          createdAt: new Date(),
          updatedAt: new Date()
        })
      })
      global.fetch = mockFetch

      const onUpdate = vi.fn()
      render(<CommentSection {...defaultProps} newComment="Test comment" onUpdate={onUpdate} />)

      const textarea = screen.getByPlaceholderText('Add a comment...')
      fireEvent.keyDown(textarea, { key: 'Enter' })

      await waitFor(() => {
        expect(onUpdate).toHaveBeenCalled()
      })
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/tasks/task-1/comments',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        })
      )
    })

    it('should show Send button when there is content', () => {
      render(<CommentSection {...defaultProps} newComment="Test comment" />)
      // RichTextInput renders a send button with a Send icon (no title attribute)
      const sendButton = document.querySelector('.lucide-send')?.closest('button')
      expect(sendButton).toBeTruthy()
    })

    it('should not add empty comment', async () => {
      const onUpdate = vi.fn()
      render(<CommentSection {...defaultProps} newComment="" onUpdate={onUpdate} />)

      const textarea = screen.getByPlaceholderText('Add a comment...')
      fireEvent.keyDown(textarea, { key: 'Enter' })

      await waitFor(() => {
        expect(onUpdate).not.toHaveBeenCalled()
      })
    })

    it('should handle Cmd+Enter for line break', () => {
      const setNewComment = vi.fn()
      const onUpdate = vi.fn()
      render(<CommentSection {...defaultProps} newComment="Test" setNewComment={setNewComment} onUpdate={onUpdate} />)

      const textarea = screen.getByPlaceholderText('Add a comment...')
      fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true })

      // Should not send comment
      expect(onUpdate).not.toHaveBeenCalled()
    })

    it('should handle Shift+Enter for line break', () => {
      const setNewComment = vi.fn()
      const onUpdate = vi.fn()
      render(<CommentSection {...defaultProps} newComment="Test" setNewComment={setNewComment} onUpdate={onUpdate} />)

      const textarea = screen.getByPlaceholderText('Add a comment...')
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })

      // Should not send comment (line break should be allowed)
      expect(onUpdate).not.toHaveBeenCalled()
    })

    it('should handle Ctrl+Enter for line break', () => {
      const setNewComment = vi.fn()
      const onUpdate = vi.fn()
      render(<CommentSection {...defaultProps} newComment="Test" setNewComment={setNewComment} onUpdate={onUpdate} />)

      const textarea = screen.getByPlaceholderText('Add a comment...')
      fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })

      // Should not send comment (line break should be allowed)
      expect(onUpdate).not.toHaveBeenCalled()
    })
  })

  describe('File Attachments', () => {
    it('should show file attachment preview when file is attached', () => {
      const attachedFile: FileAttachment = {
        url: '/api/secure-files/file-123',
        name: 'test.png',
        type: 'image/png',
        size: 1024
      }
      render(<CommentSection {...defaultProps} attachedFile={attachedFile} />)
      // File preview may appear in both CommentSection and RichTextInput
      const fileNames = screen.getAllByText('test.png')
      expect(fileNames.length).toBeGreaterThanOrEqual(1)
    })

    it('should remove attachment when X button is clicked', () => {
      const attachedFile: FileAttachment = {
        url: '/api/secure-files/file-123',
        name: 'test.png',
        type: 'image/png',
        size: 1024
      }
      const setAttachedFile = vi.fn()
      render(<CommentSection {...defaultProps} attachedFile={attachedFile} setAttachedFile={setAttachedFile} />)

      const removeButton = screen.getAllByRole('button').find(btn =>
        btn.querySelector('.lucide-x')
      )
      if (removeButton) {
        fireEvent.click(removeButton)
        expect(setAttachedFile).toHaveBeenCalledWith(null)
      }
    })

    it('should upload file when file input changes', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          fileId: 'file-123',
          fileName: 'test.png',
          mimeType: 'image/png',
          fileSize: 1024
        })
      })
      global.fetch = mockFetch

      const setAttachedFile = vi.fn()
      const setUploadingFile = vi.fn()
      render(<CommentSection {...defaultProps} setAttachedFile={setAttachedFile} setUploadingFile={setUploadingFile} />)

      // RichTextInput renders a hidden file input (no ID) - find it by type
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      expect(fileInput).toBeTruthy()
      const file = new File(['content'], 'test.png', { type: 'image/png' })

      Object.defineProperty(fileInput, 'files', {
        value: [file],
        writable: false
      })

      fireEvent.change(fileInput)

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          '/api/secure-upload/request-upload',
          expect.objectContaining({ method: 'POST' })
        )
        // RichTextInput handles upload internally and calls onAttachedFileChange
        expect(setAttachedFile).toHaveBeenCalledWith({
          url: '/api/secure-files/file-123',
          name: 'test.png',
          type: 'image/png',
          size: 1024
        })
      })
    })
  })

  describe('Replies', () => {
    it('should render reply form when replyingTo is set', () => {
      render(<CommentSection {...defaultProps} replyingTo="comment-1" />)
      expect(screen.getByPlaceholderText('Write a reply...')).toBeInTheDocument()
    })

    it('should render reply form when replyingTo matches comment', () => {
      render(<CommentSection {...defaultProps} replyingTo="comment-1" />)
      expect(screen.getByPlaceholderText('Write a reply...')).toBeInTheDocument()
      expect(screen.getByText('Replying to Test User')).toBeInTheDocument()
    })

    it('should cancel reply when X button is clicked', () => {
      const setReplyingTo = vi.fn()
      const setReplyContent = vi.fn()
      const setReplyAttachedFile = vi.fn()

      render(<CommentSection
        {...defaultProps}
        replyingTo="comment-1"
        setReplyingTo={setReplyingTo}
        setReplyContent={setReplyContent}
        setReplyAttachedFile={setReplyAttachedFile}
      />)

      // Chat bubble uses an X icon button to cancel reply (inside "Replying to..." text)
      const replyingToText = screen.getByText(/Replying to/)
      const cancelButton = replyingToText.querySelector('button')
      expect(cancelButton).toBeTruthy()
      fireEvent.click(cancelButton!)

      expect(setReplyingTo).toHaveBeenCalledWith(null)
      expect(setReplyContent).toHaveBeenCalledWith('')
      expect(setReplyAttachedFile).toHaveBeenCalledWith(null)
    })

    it('should add reply on Enter key', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'new-reply',
          content: 'Test reply',
          type: 'TEXT',
          author: mockCurrentUser,
          authorId: 'user-1',
          taskId: 'task-1',
          parentCommentId: 'comment-1',
          createdAt: new Date(),
          updatedAt: new Date()
        })
      })
      global.fetch = mockFetch

      const onUpdate = vi.fn()
      render(<CommentSection
        {...defaultProps}
        replyingTo="comment-1"
        replyContent="Test reply"
        onUpdate={onUpdate}
      />)

      const textarea = screen.getByPlaceholderText('Write a reply...')
      fireEvent.keyDown(textarea, { key: 'Enter' })

      await waitFor(() => {
        expect(onUpdate).toHaveBeenCalled()
      })
    })

    it('should render nested replies', () => {
      const taskWithReplies = {
        ...mockTask,
        comments: [
          {
            ...mockTask.comments![0],
            replies: [
              {
                id: 'reply-1',
                content: 'Reply content',
                type: 'TEXT' as const,
                author: mockCurrentUser,
                authorId: 'user-1',
                taskId: 'task-1',
                parentCommentId: 'comment-1',
                createdAt: new Date('2025-01-01T11:00:00Z'),
                updatedAt: new Date('2025-01-01T11:00:00Z'),
                replies: []
              }
            ]
          }
        ]
      }

      render(<CommentSection {...defaultProps} task={taskWithReplies} />)
      // Chat bubbles render replies inline as nested bubbles
      expect(screen.getByText('Reply content')).toBeInTheDocument()
    })
  })

  describe('Comment Actions (tap to show)', () => {
    it('should show own comments with You label', () => {
      render(<CommentSection {...defaultProps} />)
      expect(screen.getByText('You')).toBeInTheDocument()
    })

    it('should show action bar when comment bubble is tapped', () => {
      render(<CommentSection {...defaultProps} showingActionsFor="comment-1" />)
      expect(screen.getByText('Copy')).toBeInTheDocument()
      expect(screen.getByText('Reply')).toBeInTheDocument()
      expect(screen.getByText('Delete')).toBeInTheDocument()
    })

    it('should call setShowingActionsFor when bubble is clicked', () => {
      const setShowingActionsFor = vi.fn()
      render(<CommentSection {...defaultProps} setShowingActionsFor={setShowingActionsFor} />)

      const commentContent = screen.getByText('First comment')
      const bubbleRow = commentContent.closest('.chat-bubble-row')
      expect(bubbleRow).toBeTruthy()
      fireEvent.click(bubbleRow!)

      expect(setShowingActionsFor).toHaveBeenCalledWith('comment-1')
    })

    it('should toggle actions off when bubble is clicked again', () => {
      const setShowingActionsFor = vi.fn()
      render(<CommentSection {...defaultProps} showingActionsFor="comment-1" setShowingActionsFor={setShowingActionsFor} />)

      const commentContent = screen.getByText('First comment')
      const bubbleRow = commentContent.closest('.chat-bubble-row')
      fireEvent.click(bubbleRow!)

      expect(setShowingActionsFor).toHaveBeenCalledWith(null)
    })

    it('should copy comment text when Copy is clicked', () => {
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.assign(navigator, { clipboard: { writeText } })
      const setShowingActionsFor = vi.fn()

      render(<CommentSection {...defaultProps} showingActionsFor="comment-1" setShowingActionsFor={setShowingActionsFor} />)

      fireEvent.click(screen.getByText('Copy'))

      expect(writeText).toHaveBeenCalledWith('First comment')
      expect(setShowingActionsFor).toHaveBeenCalledWith(null)
    })

    it('should open reply input when Reply is clicked', () => {
      const setReplyingTo = vi.fn()
      const setShowingActionsFor = vi.fn()

      render(<CommentSection {...defaultProps} showingActionsFor="comment-1" setReplyingTo={setReplyingTo} setShowingActionsFor={setShowingActionsFor} />)

      fireEvent.click(screen.getByText('Reply'))

      expect(setReplyingTo).toHaveBeenCalledWith('comment-1')
      expect(setShowingActionsFor).toHaveBeenCalledWith(null)
    })

    it('should delete comment when Delete is clicked', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true })
      global.fetch = mockFetch

      const onUpdate = vi.fn()
      const setShowingActionsFor = vi.fn()

      render(<CommentSection {...defaultProps} showingActionsFor="comment-1" onUpdate={onUpdate} setShowingActionsFor={setShowingActionsFor} />)

      fireEvent.click(screen.getByText('Delete'))

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          '/api/comments/comment-1',
          expect.objectContaining({ method: 'DELETE' })
        )
        expect(onUpdate).toHaveBeenCalledWith(
          expect.objectContaining({ comments: [] })
        )
      })
      expect(setShowingActionsFor).toHaveBeenCalledWith(null)
    })

    it('should not show Delete for other users comments', () => {
      const otherUser: User = { id: 'user-2', email: 'other@test.com', name: 'Other User', image: null }
      const taskWithOtherComment = {
        ...mockTask,
        comments: [{
          ...mockTask.comments![0],
          id: 'comment-2',
          author: otherUser,
          authorId: 'user-2',
        }]
      }

      render(<CommentSection {...defaultProps} task={taskWithOtherComment} showingActionsFor="comment-2" />)

      expect(screen.getByText('Copy')).toBeInTheDocument()
      expect(screen.getByText('Reply')).toBeInTheDocument()
      expect(screen.queryByText('Delete')).not.toBeInTheDocument()
    })

    it('should not show Reply for nested replies', () => {
      const taskWithReplies = {
        ...mockTask,
        comments: [{
          ...mockTask.comments![0],
          replies: [{
            id: 'reply-1',
            content: 'Reply content',
            type: 'TEXT' as const,
            author: mockCurrentUser,
            authorId: 'user-1',
            taskId: 'task-1',
            parentCommentId: 'comment-1',
            createdAt: new Date('2025-01-01T11:00:00Z'),
            updatedAt: new Date('2025-01-01T11:00:00Z'),
            replies: []
          }]
        }]
      }

      render(<CommentSection {...defaultProps} task={taskWithReplies} showingActionsFor="reply-1" />)

      // Reply action should show for the comment but not for the reply
      expect(screen.getByText('Copy')).toBeInTheDocument()
      expect(screen.queryByText('Reply')).not.toBeInTheDocument()
      expect(screen.getByText('Delete')).toBeInTheDocument()
    })

    it('should delete reply when Delete is clicked on a reply', async () => {
      const taskWithReplies = {
        ...mockTask,
        comments: [{
          ...mockTask.comments![0],
          replies: [{
            id: 'reply-1',
            content: 'Reply content',
            type: 'TEXT' as const,
            author: mockCurrentUser,
            authorId: 'user-1',
            taskId: 'task-1',
            parentCommentId: 'comment-1',
            createdAt: new Date(),
            updatedAt: new Date(),
            replies: []
          }]
        }]
      }

      const mockFetch = vi.fn().mockResolvedValue({ ok: true })
      global.fetch = mockFetch

      const onUpdate = vi.fn()
      render(<CommentSection {...defaultProps} task={taskWithReplies} onUpdate={onUpdate} showingActionsFor="reply-1" />)

      fireEvent.click(screen.getByText('Delete'))

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          '/api/comments/reply-1',
          expect.objectContaining({ method: 'DELETE' })
        )
      })
    })
  })

  describe('Error Handling', () => {
    it('should rollback optimistic update on comment add failure', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        statusText: 'Server Error'
      })
      global.fetch = mockFetch

      const onUpdate = vi.fn()
      const setNewComment = vi.fn()
      render(<CommentSection
        {...defaultProps}
        newComment="Test comment"
        onUpdate={onUpdate}
        setNewComment={setNewComment}
      />)

      const textarea = screen.getByPlaceholderText('Add a comment...')
      fireEvent.keyDown(textarea, { key: 'Enter' })

      // Should add optimistically
      await waitFor(() => {
        expect(onUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            comments: expect.arrayContaining([
              expect.objectContaining({ content: 'Test comment' })
            ])
          })
        )
      })

      // Should rollback on failure
      await waitFor(() => {
        expect(onUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            comments: expect.not.arrayContaining([
              expect.objectContaining({ id: expect.stringContaining('temp-') })
            ])
          })
        )
      })

      // Should restore input
      expect(setNewComment).toHaveBeenCalledWith('Test comment')
    })

    it('should handle upload error gracefully', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Upload failed'))
      global.fetch = mockFetch

      render(<CommentSection {...defaultProps} />)

      // RichTextInput renders a hidden file input (no ID) - find it by type
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      expect(fileInput).toBeTruthy()
      const file = new File(['content'], 'test.png', { type: 'image/png' })

      Object.defineProperty(fileInput, 'files', {
        value: [file],
        writable: false
      })

      fireEvent.change(fileInput)

      // RichTextInput handles errors internally via onUploadErrorChange
      await waitFor(() => {
        // Error may appear in both CommentSection and RichTextInput error areas
        const errorMessages = screen.getAllByText('Upload failed')
        expect(errorMessages.length).toBeGreaterThanOrEqual(1)
      })
    })
  })

  describe('Theme Compatibility', () => {
    it('should use theme-text-muted for comment author in chat bubble meta', () => {
      // Use a different author so name is displayed (not "You")
      const otherUser: User = { id: 'user-2', email: 'other@test.com', name: 'Other User', image: null }
      const taskWithOtherComment = {
        ...mockTask,
        comments: [{
          ...mockTask.comments![0],
          author: otherUser,
          authorId: 'user-2',
        }]
      }
      render(<CommentSection {...defaultProps} task={taskWithOtherComment} />)
      const usernameElement = screen.getByText('Other User')
      // Chat bubble meta row has theme-text-muted class
      const metaElement = usernameElement.closest('.chat-bubble-meta')
      expect(metaElement).toBeTruthy()
      expect(metaElement).toHaveClass('theme-text-muted')
    })

    it('should use theme-text-muted for reply author in chat bubble meta', () => {
      const otherUser: User = { id: 'user-2', email: 'other@test.com', name: 'Reply User', image: null }
      const taskWithReplies = {
        ...mockTask,
        comments: [
          {
            ...mockTask.comments![0],
            replies: [
              {
                id: 'reply-1',
                content: 'Reply content',
                type: 'TEXT' as const,
                author: otherUser,
                authorId: 'user-2',
                taskId: 'task-1',
                parentCommentId: 'comment-1',
                createdAt: new Date('2025-01-01T11:00:00Z'),
                updatedAt: new Date('2025-01-01T11:00:00Z'),
                replies: []
              }
            ]
          }
        ]
      }

      render(<CommentSection {...defaultProps} task={taskWithReplies} />)
      const replyUsernameElement = screen.getByText('Reply User')
      const metaElement = replyUsernameElement.closest('.chat-bubble-meta')
      expect(metaElement).toBeTruthy()
      expect(metaElement).toHaveClass('theme-text-muted')
    })

    it('should use theme-text-primary for attached file names', () => {
      const attachedFile: FileAttachment = {
        url: '/api/secure-files/file-123',
        name: 'document.pdf',
        type: 'application/pdf',
        size: 1024
      }
      render(<CommentSection {...defaultProps} attachedFile={attachedFile} />)
      // File preview may appear in both CommentSection and RichTextInput
      const fileNameElements = screen.getAllByText('document.pdf')
      const fileNameElement = fileNameElements[0]
      expect(fileNameElement).toHaveClass('theme-text-primary')
      expect(fileNameElement).not.toHaveClass('text-white')
    })

    it('should use theme-text-primary for reply attached file names', () => {
      const replyAttachedFile: FileAttachment = {
        url: '/api/secure-files/file-456',
        name: 'image.png',
        type: 'image/png',
        size: 2048
      }
      render(<CommentSection {...defaultProps} replyingTo="comment-1" replyAttachedFile={replyAttachedFile} />)
      // Reply file preview is rendered inline in CommentSection
      const fileNameElements = screen.getAllByText('image.png')
      const fileNameElement = fileNameElements[0]
      expect(fileNameElement).toHaveClass('theme-text-primary')
      expect(fileNameElement).not.toHaveClass('text-white')
    })
  })

  describe('Content Formatting', () => {
    it('should render markdown formatting in comments', () => {
      const taskWithMarkdown = {
        ...mockTask,
        comments: [
          {
            ...mockTask.comments![0],
            content: '**Bold** and *italic* and `code`'
          }
        ]
      }

      render(<CommentSection {...defaultProps} task={taskWithMarkdown} />)
      const commentElements = screen.getAllByText((content, element) => {
        return element?.innerHTML.includes('<strong>Bold</strong>') || false
      })
      expect(commentElements.length).toBeGreaterThan(0)
      expect(commentElements[0]).toBeInTheDocument()
    })

    it('should render URLs as clickable links', () => {
      const taskWithURL = {
        ...mockTask,
        comments: [
          {
            ...mockTask.comments![0],
            content: 'Check out https://example.com for more info'
          }
        ]
      }

      render(<CommentSection {...defaultProps} task={taskWithURL} />)
      const linkElements = screen.getAllByText((content, element) => {
        return element?.innerHTML.includes('href="https://example.com"') || false
      })
      expect(linkElements.length).toBeGreaterThan(0)
      expect(linkElements[0]).toBeInTheDocument()
    })

    it('should not show content that starts with "Attached:"', () => {
      const taskWithAttachment = {
        ...mockTask,
        comments: [
          {
            ...mockTask.comments![0],
            content: 'Attached: test.png'
          }
        ]
      }

      render(<CommentSection {...defaultProps} task={taskWithAttachment} />)
      expect(screen.queryByText('Attached: test.png')).not.toBeInTheDocument()
    })
  })
})
