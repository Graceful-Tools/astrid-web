import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TaskModals } from '@/components/task-detail/TaskModals'
import type { Task, TaskList } from '@/types/task'

describe('TaskModals', () => {
  const mockTask: Task = {
    id: 'task-1',
    title: 'Test Task',
    description: 'Test description',
    completed: false,
    priority: 1,
    when: null,
    repeating: 'never',
    lists: [],
    comments: [
      { id: 'comment-1', content: 'Test comment', author: { id: '1', name: 'User 1', email: 'user1@test.com' }, createdAt: new Date(), updatedAt: new Date(), taskId: 'task-1' },
      { id: 'comment-2', content: 'Test comment 2', author: { id: '2', name: 'User 2', email: 'user2@test.com' }, createdAt: new Date(), updatedAt: new Date(), taskId: 'task-1' }
    ],
    isPrivate: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    userId: 'user-1'
  }

  const mockLists: TaskList[] = [
    { id: 'list-1', name: 'List 1', color: '#ff0000', privacy: 'PRIVATE', ownerId: 'user-1', createdAt: new Date(), updatedAt: new Date(), userId: 'user-1' },
    { id: 'list-2', name: 'List 2', color: '#00ff00', privacy: 'SHARED', ownerId: 'user-1', createdAt: new Date(), updatedAt: new Date(), userId: 'user-1' }
  ]

  const defaultProps = {
    task: mockTask,
    availableLists: mockLists,
    showDeleteConfirmation: false,
    setShowDeleteConfirmation: vi.fn(),
    onDelete: vi.fn(),
    showCopyConfirmation: false,
    setShowCopyConfirmation: vi.fn(),
    copyIncludeComments: false,
    setCopyIncludeComments: vi.fn(),
    copyTargetListId: 'list-1',
    setCopyTargetListId: vi.fn(),
    onCopy: vi.fn(),
    onClose: vi.fn(),
    showShareModal: false,
    shareUrl: null,
    loadingShareUrl: false,
    shareUrlCopied: false,
    onCopyShareUrl: vi.fn(),
    onCloseShareModal: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Delete Modal', () => {
    it('should render delete confirmation modal when shown', () => {
      render(<TaskModals {...defaultProps} showDeleteConfirmation={true} />)

      expect(screen.getByText('Delete Task')).toBeInTheDocument()
      expect(screen.getByText(/Are you sure you want to delete "Test Task"/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Don't Delete/i })).toBeInTheDocument()

      // Find the Delete button within the modal
      const deleteButtons = screen.getAllByRole('button', { name: /Delete/i })
      expect(deleteButtons.length).toBeGreaterThan(0)
    })

    it('should not render delete modal when hidden', () => {
      render(<TaskModals {...defaultProps} showDeleteConfirmation={false} />)

      expect(screen.queryByText('Delete Task')).not.toBeInTheDocument()
    })

    it('should call onDelete when confirmed', () => {
      render(<TaskModals {...defaultProps} showDeleteConfirmation={true} />)

      // Find the delete confirmation button by looking for the one with Trash2 icon
      const deleteButtons = screen.getAllByRole('button')
      const deleteButton = deleteButtons.find(btn => btn.textContent === 'Delete')
      expect(deleteButton).toBeDefined()

      if (deleteButton) {
        fireEvent.click(deleteButton)
      }

      expect(defaultProps.onDelete).toHaveBeenCalledWith('task-1')
      expect(defaultProps.setShowDeleteConfirmation).toHaveBeenCalledWith(false)
    })

    it('should close modal when cancelled', () => {
      render(<TaskModals {...defaultProps} showDeleteConfirmation={true} />)

      fireEvent.click(screen.getByRole('button', { name: /Don't Delete/i }))

      expect(defaultProps.setShowDeleteConfirmation).toHaveBeenCalledWith(false)
      expect(defaultProps.onDelete).not.toHaveBeenCalled()
    })

    it('should close modal when clicking backdrop', () => {
      const { container } = render(<TaskModals {...defaultProps} showDeleteConfirmation={true} />)

      // Find the backdrop (the outer div with bg-black/50)
      const backdrop = container.querySelector('.bg-black\\/50')
      expect(backdrop).toBeTruthy()

      if (backdrop) {
        fireEvent.click(backdrop)
        expect(defaultProps.setShowDeleteConfirmation).toHaveBeenCalledWith(false)
      }
    })
  })

  describe('Copy Modal', () => {
    it('should render copy confirmation modal when shown', () => {
      render(<TaskModals {...defaultProps} showCopyConfirmation={true} />)

      expect(screen.getByText('Copy Task')).toBeInTheDocument()
      expect(screen.getByText(/Create a copy of "Test Task"/)).toBeInTheDocument()
      expect(screen.getByText('Copy to list:')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Copy/i })).toBeInTheDocument()
    })

    it('should not render copy modal when hidden', () => {
      render(<TaskModals {...defaultProps} showCopyConfirmation={false} />)

      expect(screen.queryByText('Copy Task')).not.toBeInTheDocument()
    })

    it('should show available lists in dropdown', () => {
      render(<TaskModals {...defaultProps} showCopyConfirmation={true} />)

      const select = screen.getByRole('combobox')
      expect(select).toBeInTheDocument()

      const options = screen.getAllByRole('option')
      expect(options).toHaveLength(3) // Default "My Tasks (only)" + 2 lists
      expect(options[0]).toHaveTextContent('My Tasks (only)')
      expect(options[1]).toHaveTextContent('List 1')
      expect(options[2]).toHaveTextContent('List 2')
    })

    it('should show comment count and allow toggling include comments', () => {
      render(<TaskModals {...defaultProps} showCopyConfirmation={true} />)

      expect(screen.getByText(/Include comments \(2 comments\)/)).toBeInTheDocument()

      const checkbox = screen.getByRole('checkbox')
      expect(checkbox).not.toBeChecked()

      fireEvent.click(checkbox)
      expect(defaultProps.setCopyIncludeComments).toHaveBeenCalledWith(true)
    })

    it('should call onCopy when confirmed', async () => {
      const mockOnCopy = vi.fn().mockResolvedValue(undefined)
      render(<TaskModals {...defaultProps} showCopyConfirmation={true} onCopy={mockOnCopy} />)

      fireEvent.click(screen.getByRole('button', { name: /^Copy$/i }))

      await waitFor(() => {
        expect(mockOnCopy).toHaveBeenCalledWith('task-1', 'list-1', false)
      })
      expect(defaultProps.setShowCopyConfirmation).toHaveBeenCalledWith(false)
      expect(defaultProps.onClose).toHaveBeenCalled()
    })

    it('should update target list when selection changes', () => {
      render(<TaskModals {...defaultProps} showCopyConfirmation={true} />)

      const select = screen.getByRole('combobox')
      fireEvent.change(select, { target: { value: 'list-2' } })

      expect(defaultProps.setCopyTargetListId).toHaveBeenCalledWith('list-2')
    })

    it('should close modal when cancelled', () => {
      render(<TaskModals {...defaultProps} showCopyConfirmation={true} />)

      fireEvent.click(screen.getByRole('button', { name: /Cancel/i }))

      expect(defaultProps.setShowCopyConfirmation).toHaveBeenCalledWith(false)
      expect(defaultProps.onCopy).not.toHaveBeenCalled()
    })

    it('should handle copy without onCopy callback (fallback to API)', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ task: { id: 'new-task-id' } })
      })

      render(<TaskModals {...defaultProps} showCopyConfirmation={true} onCopy={undefined} />)

      fireEvent.click(screen.getByRole('button', { name: /^Copy$/i }))

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith('/api/v1/tasks/task-1/copy', expect.any(Object))
      })
    })

    it('should show singular comment text for 1 comment', () => {
      const taskWithOneComment = {
        ...mockTask,
        comments: [{ id: 'comment-1', content: 'Test comment', author: { id: '1', name: 'User 1', email: 'user1@test.com' }, createdAt: new Date(), updatedAt: new Date(), taskId: 'task-1' }]
      }
      render(<TaskModals {...defaultProps} task={taskWithOneComment} showCopyConfirmation={true} />)

      expect(screen.getByText(/Include comments \(1 comment\)/)).toBeInTheDocument()
    })
  })

  describe('Share Modal', () => {
    it('should render share modal when shown', () => {
      render(<TaskModals {...defaultProps} showShareModal={true} />)

      expect(screen.getByText('Share Task')).toBeInTheDocument()
      expect(screen.getByText(/Create a shareable link for "Test Task"/)).toBeInTheDocument()
    })

    it('should not render share modal when hidden', () => {
      render(<TaskModals {...defaultProps} showShareModal={false} />)

      expect(screen.queryByText('Share Task')).not.toBeInTheDocument()
    })

    it('should show loading state when generating share URL', () => {
      render(<TaskModals {...defaultProps} showShareModal={true} loadingShareUrl={true} />)

      expect(screen.getByText('Generating share link...')).toBeInTheDocument()
    })

    it('should show share URL when generated', () => {
      render(<TaskModals {...defaultProps} showShareModal={true} shareUrl="https://astrid.cc/t/abc123" />)

      expect(screen.getByText('https://astrid.cc/t/abc123')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Copy/i })).toBeInTheDocument()
    })

    it('should show error when share URL generation fails', () => {
      render(<TaskModals {...defaultProps} showShareModal={true} shareUrl={null} loadingShareUrl={false} />)

      // When loadingShareUrl is false and shareUrl is null, it means generation failed
      expect(screen.getByText(/Failed to generate share link/)).toBeInTheDocument()
    })

    // The clipboard write itself moved to useTaskShareLink (task 72cb4a13);
    // this component's job is now only to wire the button to it. The write,
    // the copied flag and its 2s reset are covered in
    // tests/hooks/useTaskShareLink.test.ts.
    it('should invoke onCopyShareUrl when the copy button is clicked', () => {
      render(<TaskModals {...defaultProps} showShareModal={true} shareUrl="https://astrid.cc/t/abc123" />)

      fireEvent.click(screen.getByRole('button', { name: /Copy/i }))

      expect(defaultProps.onCopyShareUrl).toHaveBeenCalled()
    })

    it('should show private task warning for private tasks', () => {
      const privateTask = { ...mockTask, isPrivate: true }
      render(<TaskModals {...defaultProps} task={privateTask} showShareModal={true} />)

      expect(screen.getByText(/This is a private task/)).toBeInTheDocument()
      expect(screen.getByText(/Only users with access to this list can view it/)).toBeInTheDocument()
    })

    it('should invoke onCloseShareModal when the close button is clicked', () => {
      render(<TaskModals {...defaultProps} showShareModal={true} shareUrl="https://astrid.cc/t/abc123" />)

      fireEvent.click(screen.getByRole('button', { name: /Close/i }))

      // Clearing the url and the copied flag is the hook's responsibility now
      // — asserted in tests/hooks/useTaskShareLink.test.ts.
      expect(defaultProps.onCloseShareModal).toHaveBeenCalled()
    })

    it('should show copied state after copying URL', () => {
      render(<TaskModals {...defaultProps} showShareModal={true} shareUrl="https://astrid.cc/t/abc123" shareUrlCopied={true} />)

      expect(screen.getByRole('button', { name: /Copied!/i })).toBeInTheDocument()
    })
  })

  describe('Modal Interactions', () => {
    it('should prevent event propagation when clicking modal content', () => {
      render(<TaskModals {...defaultProps} showDeleteConfirmation={true} />)

      const modalContent = screen.getByText('Delete Task').parentElement
      if (modalContent) {
        const stopPropagation = vi.fn()
        fireEvent.click(modalContent, { stopPropagation })

        // Modal should not close when clicking content
        expect(defaultProps.setShowDeleteConfirmation).not.toHaveBeenCalled()
      }
    })

    it('should only render one modal at a time', () => {
      const { rerender } = render(<TaskModals {...defaultProps} showDeleteConfirmation={true} />)
      expect(screen.getByText('Delete Task')).toBeInTheDocument()
      expect(screen.queryByText('Copy Task')).not.toBeInTheDocument()
      expect(screen.queryByText('Share Task')).not.toBeInTheDocument()

      rerender(<TaskModals {...defaultProps} showDeleteConfirmation={false} showCopyConfirmation={true} />)
      expect(screen.queryByText('Delete Task')).not.toBeInTheDocument()
      expect(screen.getByText('Copy Task')).toBeInTheDocument()
      expect(screen.queryByText('Share Task')).not.toBeInTheDocument()

      rerender(<TaskModals {...defaultProps} showDeleteConfirmation={false} showCopyConfirmation={false} showShareModal={true} />)
      expect(screen.queryByText('Delete Task')).not.toBeInTheDocument()
      expect(screen.queryByText('Copy Task')).not.toBeInTheDocument()
      expect(screen.getByText('Share Task')).toBeInTheDocument()
    })
  })

  describe('Error Handling', () => {
    it('should handle copy task errors gracefully', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      const mockOnCopy = vi.fn().mockRejectedValue(new Error('Copy failed'))

      render(<TaskModals {...defaultProps} showCopyConfirmation={true} onCopy={mockOnCopy} />)

      fireEvent.click(screen.getByRole('button', { name: /^Copy$/i }))

      await waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith('Failed to copy task:', expect.any(Error))
      })

      consoleError.mockRestore()
    })
  })
})
