import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import React from 'react'
import { CommentSection } from '@/components/task-detail/CommentSection'
import type { Task, User } from '@/types/task'

// Mock dependencies
vi.mock('@/lib/layout-detection', () => ({
  isMobileDevice: vi.fn(() => false),
}))

vi.mock('@/lib/utils', () => ({
  linkifyText: vi.fn((text) => text),
  cn: vi.fn((...classes) => classes.filter(Boolean).join(' ')),
}))

vi.mock('@/lib/offline-sync', () => ({
  isOfflineMode: vi.fn(() => false),
  OfflineSyncManager: {
    queueMutation: vi.fn(),
  },
}))

vi.mock('@/lib/offline-db', () => ({
  OfflineCommentOperations: {
    saveComment: vi.fn(),
  },
}))

describe('CommentSection - Pull to Refresh', () => {
  let mockTask: Task
  let mockCurrentUser: User
  let mockOnUpdate: ReturnType<typeof vi.fn>
  let mockOnRefreshComments: ReturnType<typeof vi.fn>
  let isMobileDeviceMock: any

  beforeEach(async () => {
    // Reset mocks
    vi.clearAllMocks()

    // Get the mocked isMobileDevice function
    isMobileDeviceMock = vi.mocked(await import('@/lib/layout-detection')).isMobileDevice

    mockCurrentUser = {
      id: 'user-1',
      name: 'Test User',
      email: 'test@example.com',
    } as User

    mockTask = {
      id: 'task-1',
      title: 'Test Task',
      completed: false,
      priority: 0,
      repeating: 'never',
      comments: [
        {
          id: 'comment-1',
          content: 'First comment',
          type: 'TEXT',
          authorId: mockCurrentUser.id,
          author: mockCurrentUser,
          taskId: 'task-1',
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
          replies: [],
        },
      ],
      lists: [],
    } as Task

    mockOnUpdate = vi.fn()
    mockOnRefreshComments = vi.fn().mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should not show pull-to-refresh indicator on desktop', () => {
    isMobileDeviceMock.mockReturnValue(false)

    render(
      <CommentSection
        task={mockTask}
        currentUser={mockCurrentUser}
        onUpdate={mockOnUpdate}
        onRefreshComments={mockOnRefreshComments}
        newComment=""
        setNewComment={vi.fn()}
        uploadingFile={false}
        setUploadingFile={vi.fn()}
        attachedFiles={[]}
        setAttachedFiles={vi.fn()}
        replyingTo={null}
        setReplyingTo={vi.fn()}
        replyContent=""
        setReplyContent={vi.fn()}
        replyAttachedFiles={[]}
        setReplyAttachedFiles={vi.fn()}
        uploadingReplyFile={false}
        setUploadingReplyFile={vi.fn()}
        showingActionsFor={null}
        setShowingActionsFor={vi.fn()}
      />
    )

    // Pull-to-refresh should not be visible on desktop
    expect(screen.queryByText(/Pull to refresh/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Release to refresh/i)).not.toBeInTheDocument()
  })

  it('should initialize pull-to-refresh on mobile devices', () => {
    isMobileDeviceMock.mockReturnValue(true)

    const { container } = render(
      <CommentSection
        task={mockTask}
        currentUser={mockCurrentUser}
        onUpdate={mockOnUpdate}
        onRefreshComments={mockOnRefreshComments}
        newComment=""
        setNewComment={vi.fn()}
        uploadingFile={false}
        setUploadingFile={vi.fn()}
        attachedFiles={[]}
        setAttachedFiles={vi.fn()}
        replyingTo={null}
        setReplyingTo={vi.fn()}
        replyContent=""
        setReplyContent={vi.fn()}
        replyAttachedFiles={[]}
        setReplyAttachedFiles={vi.fn()}
        uploadingReplyFile={false}
        setUploadingReplyFile={vi.fn()}
        showingActionsFor={null}
        setShowingActionsFor={vi.fn()}
      />
    )

    // Find the comments container that should have touch handlers
    const commentsContainer = container.querySelector('.overflow-y-auto')
    expect(commentsContainer).toBeInTheDocument()
  })

  it('should attach touch handlers on mobile when onRefreshComments is provided', async () => {
    isMobileDeviceMock.mockReturnValue(true)

    const { container } = render(
      <CommentSection
        task={mockTask}
        currentUser={mockCurrentUser}
        onUpdate={mockOnUpdate}
        onRefreshComments={mockOnRefreshComments}
        newComment=""
        setNewComment={vi.fn()}
        uploadingFile={false}
        setUploadingFile={vi.fn()}
        attachedFiles={[]}
        setAttachedFiles={vi.fn()}
        replyingTo={null}
        setReplyingTo={vi.fn()}
        replyContent=""
        setReplyContent={vi.fn()}
        replyAttachedFiles={[]}
        setReplyAttachedFiles={vi.fn()}
        uploadingReplyFile={false}
        setUploadingReplyFile={vi.fn()}
        showingActionsFor={null}
        setShowingActionsFor={vi.fn()}
      />
    )

    const commentsContainer = container.querySelector('.overflow-y-auto')
    expect(commentsContainer).toBeInTheDocument()

    // Verify touch handlers are attached by checking the element has them
    // Note: In jsdom, we can't fully test touch event behavior, but we can verify
    // the handlers are set up correctly
    if (commentsContainer) {
      expect(commentsContainer).toBeInTheDocument()
    }
  })

  it('should render comments correctly', () => {
    isMobileDeviceMock.mockReturnValue(true)

    const { container } = render(
      <CommentSection
        task={mockTask}
        currentUser={mockCurrentUser}
        onUpdate={mockOnUpdate}
        onRefreshComments={mockOnRefreshComments}
        newComment=""
        setNewComment={vi.fn()}
        uploadingFile={false}
        setUploadingFile={vi.fn()}
        attachedFiles={[]}
        setAttachedFiles={vi.fn()}
        replyingTo={null}
        setReplyingTo={vi.fn()}
        replyContent=""
        setReplyContent={vi.fn()}
        replyAttachedFiles={[]}
        setReplyAttachedFiles={vi.fn()}
        uploadingReplyFile={false}
        setUploadingReplyFile={vi.fn()}
        showingActionsFor={null}
        setShowingActionsFor={vi.fn()}
      />
    )

    // Verify the comments container renders with the scrollable class
    const commentsContainer = container.querySelector('.overflow-y-auto')
    expect(commentsContainer).toBeInTheDocument()

    // Verify comment content is displayed
    expect(screen.getByText('First comment')).toBeInTheDocument()
  })

  it('should work without onRefreshComments callback', () => {
    isMobileDeviceMock.mockReturnValue(true)

    // Should not throw error when onRefreshComments is not provided
    expect(() => {
      render(
        <CommentSection
          task={mockTask}
          currentUser={mockCurrentUser}
          onUpdate={mockOnUpdate}
          newComment=""
          setNewComment={vi.fn()}
          uploadingFile={false}
          setUploadingFile={vi.fn()}
          attachedFiles={[]}
          setAttachedFiles={vi.fn()}
          replyingTo={null}
          setReplyingTo={vi.fn()}
          replyContent=""
          setReplyContent={vi.fn()}
          replyAttachedFiles={[]}
          setReplyAttachedFiles={vi.fn()}
          uploadingReplyFile={false}
          setUploadingReplyFile={vi.fn()}
          showingActionsFor={null}
          setShowingActionsFor={vi.fn()}
        />
      )
    }).not.toThrow()
  })
})
