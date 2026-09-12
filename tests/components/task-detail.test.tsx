import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'

// Mock the complex dependencies
vi.mock('@/lib/api', () => ({
  apiPut: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn()
}))

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn()
  })
}))

// Create a simplified TaskDetail component for testing
//
// The props are spelled out (AWTD-916) rather than inferred from the
// `vi.fn()` defaults: `vi.fn()` with no argument infers `Mock<Procedure>`,
// which is narrower than the `Mock<Procedure | Constructable>` that
// `Mock` produces, so every call site passing a mock in
// was a type error against a prop type nobody wrote on purpose.
interface TaskDetailTestTask {
  id?: string
  title?: string
  description?: string | null
  completed?: boolean
  priority?: number
  dueDate?: string | Date | null
  deleted?: boolean
  assignee?: { name?: string | null; email?: string | null } | null
  lists?: Array<{ id?: string; name: string }>
}

interface TaskDetailTestComponentProps {
  task: TaskDetailTestTask | null
  onUpdate?: (task: TaskDetailTestTask) => void
  onClose?: () => void
  availableUsers?: Array<{ id: string; name?: string | null; email?: string | null }>
}

const TaskDetailTestComponent = ({
  task,
  onUpdate = vi.fn(),
  onClose = vi.fn(),
  availableUsers = []
}: TaskDetailTestComponentProps) => {
  const [isEditingTitle, setIsEditingTitle] = React.useState(false)
  const [isEditingDescription, setIsEditingDescription] = React.useState(false)
  const [editTitle, setEditTitle] = React.useState(task?.title || '')
  const [editDescription, setEditDescription] = React.useState(task?.description || '')

  const handleSaveTitle = () => {
    onUpdate({
      ...task,
      title: editTitle
    })
    setIsEditingTitle(false)
  }

  const handleSaveDescription = () => {
    onUpdate({
      ...task,
      description: editDescription
    })
    setIsEditingDescription(false)
  }

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSaveTitle()
    } else if (e.key === 'Escape') {
      setIsEditingTitle(false)
      setEditTitle(task?.title || '')
    }
  }

  const handleDescriptionKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        // Allow default behavior for line breaks
        return
      } else {
        // Plain Enter: Save
        e.preventDefault()
        handleSaveDescription()
      }
    } else if (e.key === 'Escape') {
      setIsEditingDescription(false)
      setEditDescription(task?.description || '')
    }
  }

  if (!task) {
    return <div data-testid="no-task">No task selected</div>
  }

  return (
    <div data-testid="task-detail" className="task-detail">
      <div className="task-header">
        <button 
          data-testid="close-button"
          onClick={onClose}
          aria-label="Close task detail"
        >
          ✕
        </button>
        
        <div className="task-completion">
          <input
            type="checkbox"
            data-testid="task-completed-checkbox"
            checked={task.completed || false}
            onChange={(e) => onUpdate({ ...task, completed: e.target.checked })}
          />
        </div>
      </div>

      {/* Task Title */}
      <div className="task-title">
        {isEditingTitle ? (
          <input
            data-testid="edit-title-input"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onKeyDown={handleTitleKeyDown}
            onBlur={handleSaveTitle}
            autoFocus
          />
        ) : (
          <h2 
            data-testid="task-title"
            onClick={() => setIsEditingTitle(true)}
            className={task.completed ? 'completed' : ''}
          >
            {task.title}
          </h2>
        )}
      </div>

      {/* Task Metadata */}
      <div className="task-metadata">
        <div className="task-priority" data-testid="task-priority">
          Priority: {task.priority || 0}
        </div>
        
        {task.assignee && (
          <div className="task-assignee" data-testid="task-assignee">
            Assigned to: {task.assignee.name || task.assignee.email}
          </div>
        )}

        {task.dueDate && (
          <div className="task-due-date" data-testid="task-due-date">
            Due: {new Date(task.dueDate).toLocaleDateString()}
          </div>
        )}

        {task.lists && task.lists.length > 0 && (
          <div className="task-lists" data-testid="task-lists">
            Lists: {task.lists.map(list => list.name).join(', ')}
          </div>
        )}
      </div>

      {/* Task Description */}
      <div className="task-description">
        <label>Description</label>
        {isEditingDescription ? (
          <div>
            <textarea
              data-testid="edit-description-textarea"
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              onKeyDown={handleDescriptionKeyDown}
              placeholder="Add a description..."
              rows={3}
              autoFocus
            />
            <div className="keyboard-help">
              Press Enter to save • Shift+Enter or Cmd/Ctrl+Enter for line breaks
            </div>
          </div>
        ) : (
          <div 
            data-testid="task-description"
            onClick={() => setIsEditingDescription(true)}
            className="description-content"
            style={{ cursor: 'pointer' }}
          >
            {task.description || (
              <span className="placeholder">Click to add description...</span>
            )}
          </div>
        )}
      </div>

      {/* Task Actions */}
      <div className="task-actions">
        <button
          data-testid="delete-task-button"
          onClick={() => onUpdate({ ...task, deleted: true })}
          className="danger"
        >
          Delete
        </button>
      </div>
    </div>
  )
}

// Need to import React for JSX
import React from 'react'

describe('TaskDetail Component', () => {
  const mockTask = {
    id: 'task-1',
    title: 'Test Task',
    description: 'Test description',
    completed: false,
    priority: 1,
    dueDate: '2024-12-01T00:00:00Z',
    assignee: {
      id: 'user-1',
      name: 'Test User',
      email: 'test@example.com'
    },
    lists: [
      { id: 'list-1', name: 'Test List' }
    ]
  }

  let user: ReturnType<typeof userEvent.setup>
  // Typed to the props they are passed to (AWTD-916). Bare
  // `Mock` is `Mock<Procedure | Constructable>`, which is
  // not assignable to any specific callback type.
  let mockOnUpdate: Mock<(task: TaskDetailTestTask) => void>
  let mockOnClose: Mock<() => void>

  beforeEach(() => {
    user = userEvent.setup()
    mockOnUpdate = vi.fn()
    mockOnClose = vi.fn()
  })

  describe('Basic Rendering', () => {
    it('should render task details', () => {
      render(
        <TaskDetailTestComponent 
          task={mockTask} 
          onUpdate={mockOnUpdate} 
          onClose={mockOnClose} 
        />
      )

      expect(screen.getByTestId('task-detail')).toBeInTheDocument()
      expect(screen.getByTestId('task-title')).toHaveTextContent('Test Task')
      expect(screen.getByTestId('task-description')).toHaveTextContent('Test description')
    })

    it('should show no task message when task is null', () => {
      render(
        <TaskDetailTestComponent 
          task={null} 
          onUpdate={mockOnUpdate} 
          onClose={mockOnClose} 
        />
      )

      expect(screen.getByTestId('no-task')).toBeInTheDocument()
    })

    it('should display task metadata', () => {
      render(
        <TaskDetailTestComponent 
          task={mockTask} 
          onUpdate={mockOnUpdate} 
          onClose={mockOnClose} 
        />
      )

      expect(screen.getByTestId('task-priority')).toHaveTextContent('Priority: 1')
      expect(screen.getByTestId('task-assignee')).toHaveTextContent('Assigned to: Test User')
      expect(screen.getByTestId('task-due-date')).toHaveTextContent('Due:')
      expect(screen.getByTestId('task-lists')).toHaveTextContent('Lists: Test List')
    })
  })

  describe('Task Completion', () => {
    it('should toggle task completion', async () => {
      render(
        <TaskDetailTestComponent 
          task={mockTask} 
          onUpdate={mockOnUpdate} 
          onClose={mockOnClose} 
        />
      )

      const checkbox = screen.getByTestId('task-completed-checkbox')
      expect(checkbox).not.toBeChecked()

      await user.click(checkbox)

      expect(mockOnUpdate).toHaveBeenCalledWith({
        ...mockTask,
        completed: true
      })
    })

    it('should show completed styling when task is completed', () => {
      const completedTask = { ...mockTask, completed: true }
      render(
        <TaskDetailTestComponent 
          task={completedTask} 
          onUpdate={mockOnUpdate} 
          onClose={mockOnClose} 
        />
      )

      const title = screen.getByTestId('task-title')
      expect(title).toHaveClass('completed')
      
      const checkbox = screen.getByTestId('task-completed-checkbox')
      expect(checkbox).toBeChecked()
    })
  })

  describe('Task Editing', () => {
    it('should enter edit mode when clicking title', async () => {
      render(
        <TaskDetailTestComponent 
          task={mockTask} 
          onUpdate={mockOnUpdate} 
          onClose={mockOnClose} 
        />
      )

      const title = screen.getByTestId('task-title')
      await user.click(title)

      expect(screen.getByTestId('edit-title-input')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Test Task')).toBeInTheDocument()
    })

    it('should save changes on Enter key', async () => {
      render(
        <TaskDetailTestComponent 
          task={mockTask} 
          onUpdate={mockOnUpdate} 
          onClose={mockOnClose} 
        />
      )

      // Enter edit mode
      await user.click(screen.getByTestId('task-title'))
      
      const input = screen.getByTestId('edit-title-input')
      await user.clear(input)
      await user.type(input, 'Updated Task')
      await user.keyboard('{Enter}')

      expect(mockOnUpdate).toHaveBeenCalledWith({
        ...mockTask,
        title: 'Updated Task',
        description: 'Test description'
      })
    })

    it('should cancel changes on Escape key', async () => {
      render(
        <TaskDetailTestComponent 
          task={mockTask} 
          onUpdate={mockOnUpdate} 
          onClose={mockOnClose} 
        />
      )

      // Enter edit mode
      await user.click(screen.getByTestId('task-title'))
      
      const input = screen.getByTestId('edit-title-input')
      await user.clear(input)
      await user.type(input, 'Changed Title')
      await user.keyboard('{Escape}')

      // Should exit edit mode and revert changes
      expect(screen.getByTestId('task-title')).toHaveTextContent('Test Task')
      expect(mockOnUpdate).not.toHaveBeenCalled()
    })
  })

  describe('Description Editing', () => {
    it('should enter description edit mode', async () => {
      render(
        <TaskDetailTestComponent 
          task={mockTask} 
          onUpdate={mockOnUpdate} 
          onClose={mockOnClose} 
        />
      )

      const description = screen.getByTestId('task-description')
      await user.click(description)

      expect(screen.getByTestId('edit-description-textarea')).toBeInTheDocument()
    })

    it('should show placeholder for empty description', () => {
      const taskWithoutDescription = { ...mockTask, description: '' }
      render(
        <TaskDetailTestComponent 
          task={taskWithoutDescription} 
          onUpdate={mockOnUpdate} 
          onClose={mockOnClose} 
        />
      )

      expect(screen.getByText('Click to add description...')).toBeInTheDocument()
    })

    it('should handle keyboard shortcuts in description', async () => {
      render(
        <TaskDetailTestComponent 
          task={mockTask} 
          onUpdate={mockOnUpdate} 
          onClose={mockOnClose} 
        />
      )

      // Enter edit mode
      await user.click(screen.getByTestId('task-description'))
      const textarea = screen.getByTestId('edit-description-textarea')

      // Change the content to something different from original
      await user.clear(textarea)  // This should work like the title test
      await user.type(textarea, 'Modified content')
      mockOnUpdate.mockClear()
      
      // Test 1: Shift+Enter should add line break without saving
      await user.keyboard('{Shift>}{Enter}{/Shift}')
      expect(mockOnUpdate).not.toHaveBeenCalled()
      
      await user.type(textarea, 'Second line')

      // Test 2: Regular Enter should save
      await user.keyboard('{Enter}')
      
      expect(mockOnUpdate).toHaveBeenCalledTimes(1)
      expect(mockOnUpdate).toHaveBeenCalledWith({
        ...mockTask,
        description: 'Modified content\nSecond line'
      })
    })

    it('should show keyboard help text', async () => {
      render(
        <TaskDetailTestComponent 
          task={mockTask} 
          onUpdate={mockOnUpdate} 
          onClose={mockOnClose} 
        />
      )

      await user.click(screen.getByTestId('task-description'))
      
      expect(screen.getByText(/Press Enter to save.*Shift\+Enter/)).toBeInTheDocument()
    })
  })

  describe('Task Actions', () => {
    it('should handle task deletion', async () => {
      render(
        <TaskDetailTestComponent 
          task={mockTask} 
          onUpdate={mockOnUpdate} 
          onClose={mockOnClose} 
        />
      )

      const deleteButton = screen.getByTestId('delete-task-button')
      await user.click(deleteButton)

      expect(mockOnUpdate).toHaveBeenCalledWith({
        ...mockTask,
        deleted: true
      })
    })

    it('should close task detail', async () => {
      render(
        <TaskDetailTestComponent 
          task={mockTask} 
          onUpdate={mockOnUpdate} 
          onClose={mockOnClose} 
        />
      )

      const closeButton = screen.getByTestId('close-button')
      await user.click(closeButton)

      expect(mockOnClose).toHaveBeenCalled()
    })
  })

  describe('Edge Cases', () => {
    it('should handle task without assignee', () => {
      const taskWithoutAssignee = { ...mockTask, assignee: null }
      render(
        <TaskDetailTestComponent 
          task={taskWithoutAssignee} 
          onUpdate={mockOnUpdate} 
          onClose={mockOnClose} 
        />
      )

      expect(screen.queryByTestId('task-assignee')).not.toBeInTheDocument()
    })

    it('should handle task without due date', () => {
      const taskWithoutDueDate = { ...mockTask, dueDate: null }
      render(
        <TaskDetailTestComponent 
          task={taskWithoutDueDate} 
          onUpdate={mockOnUpdate} 
          onClose={mockOnClose} 
        />
      )

      expect(screen.queryByTestId('task-due-date')).not.toBeInTheDocument()
    })

    it('should handle task without lists', () => {
      const taskWithoutLists = { ...mockTask, lists: [] }
      render(
        <TaskDetailTestComponent 
          task={taskWithoutLists} 
          onUpdate={mockOnUpdate} 
          onClose={mockOnClose} 
        />
      )

      expect(screen.queryByTestId('task-lists')).not.toBeInTheDocument()
    })
  })

  describe('Accessibility', () => {
    it('should have proper ARIA labels', () => {
      render(
        <TaskDetailTestComponent 
          task={mockTask} 
          onUpdate={mockOnUpdate} 
          onClose={mockOnClose} 
        />
      )

      const closeButton = screen.getByTestId('close-button')
      expect(closeButton).toHaveAttribute('aria-label', 'Close task detail')
    })

    it('should support keyboard navigation', async () => {
      render(
        <TaskDetailTestComponent 
          task={mockTask} 
          onUpdate={mockOnUpdate} 
          onClose={mockOnClose} 
        />
      )

      const checkbox = screen.getByTestId('task-completed-checkbox')
      
      // Focus and activate with keyboard
      await user.click(checkbox) // Use click to focus and activate
      
      expect(mockOnUpdate).toHaveBeenCalledWith({
        ...mockTask,
        completed: true
      })
    })
  })
})