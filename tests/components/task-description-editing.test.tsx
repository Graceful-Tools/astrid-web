import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TaskFieldEditors } from '@/components/task-detail/TaskFieldEditors'
import type { Task, TaskList, User } from '@/types/task'

// Mock mobile keyboard hook
vi.mock('@/hooks/shared/useMobileKeyboard', () => ({
  useMobileKeyboard: () => ({
    keyboardVisible: false,
    viewportHeight: 800,
    shouldPreventFocus: false,
    needsProtection: false,
    shouldIgnoreTouch: false,
    focusProtectionThreshold: 300
  })
}))

describe('Task Description Editing', () => {
  const mockCurrentUser: User = {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    image: null,
    createdAt: new Date()
  }

  const mockTask: Task = {
    id: 'task-1',
    title: 'Test Task',
    description: 'Original description',
    priority: 1,
    completed: false,
    lists: [],
    creatorId: 'user-1',
    assigneeId: null,
    assignee: null,
    when: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    repeating: 'never'
  }

  const mockOnUpdate = vi.fn()
  const mockOnInviteUser = vi.fn()
  const descriptionTextareaRef = { current: null }
  const descriptionRef = { current: null }

  const defaultProps = {
    task: mockTask,
    currentUser: mockCurrentUser,
    availableLists: [],
    onUpdate: mockOnUpdate,
    onInviteUser: mockOnInviteUser,
    editingTitle: false,
    setEditingTitle: vi.fn(),
    editingDescription: true, // Start in editing mode
    setEditingDescription: vi.fn(),
    editingWhen: false,
    setEditingWhen: vi.fn(),
    editingTime: false,
    setEditingTime: vi.fn(),
    editingPriority: false,
    setEditingPriority: vi.fn(),
    editingRepeating: false,
    setEditingRepeating: vi.fn(),
    editingLists: false,
    setEditingLists: vi.fn(),
    editingAssignee: false,
    setEditingAssignee: vi.fn(),
    assigneeRef: { current: null },
    descriptionRef,
    descriptionTextareaRef,
    tempTitle: mockTask.title,
    setTempTitle: vi.fn(),
    tempDescription: mockTask.description || '',
    setTempDescription: vi.fn(),
    tempWhen: undefined,
    setTempWhen: vi.fn(),
    tempPriority: 1,
    setTempPriority: vi.fn(),
    tempRepeating: 'never' as const,
    setTempRepeating: vi.fn(),
    tempRepeatingData: null,
    setTempRepeatingData: vi.fn(),
    tempLists: [],
    setTempLists: vi.fn(),
    listSearchTerm: '',
    setListSearchTerm: vi.fn(),
    showListSuggestions: false,
    setShowListSuggestions: vi.fn(),
    selectedSuggestionIndex: 0,
    setSelectedSuggestionIndex: vi.fn(),
    listSearchRef: { current: null },
    listInputRef: { current: null },
    tempAssignee: null,
    setTempAssignee: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Keyboard Behavior', () => {
    it('should use simple textarea without Edit/Preview tabs', () => {
      render(<TaskFieldEditors {...defaultProps} />)

      // Should NOT have Edit/Preview buttons
      expect(screen.queryByText('Edit')).toBeNull()
      expect(screen.queryByText('Preview')).toBeNull()

      // Should have textarea
      const textarea = screen.getByPlaceholderText('Add a description...')
      expect(textarea.tagName).toBe('TEXTAREA')
    })

    it('should add line break on Shift+Enter', async () => {
      const user = userEvent.setup()
      const setTempDescription = vi.fn()

      render(
        <TaskFieldEditors
          {...defaultProps}
          tempDescription="First line"
          setTempDescription={setTempDescription}
        />
      )

      const textarea = screen.getByPlaceholderText('Add a description...')

      // Type Shift+Enter
      await user.type(textarea, '{Shift>}{Enter}{/Shift}')

      // Should NOT save (line break should be default behavior)
      expect(mockOnUpdate).not.toHaveBeenCalled()
    })

    it('should save on plain Enter key', async () => {
      const user = userEvent.setup()
      const setEditingDescription = vi.fn()

      render(
        <TaskFieldEditors
          {...defaultProps}
          tempDescription="Updated description"
          setEditingDescription={setEditingDescription}
        />
      )

      const textarea = screen.getByPlaceholderText('Add a description...')

      // Press Enter without modifiers
      await user.type(textarea, '{Enter}')

      // Should save the description
      expect(mockOnUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Updated description'
        })
      )
    })

    it('should cancel on Escape key', async () => {
      const user = userEvent.setup()
      const setEditingDescription = vi.fn()
      const setTempDescription = vi.fn()

      render(
        <TaskFieldEditors
          {...defaultProps}
          tempDescription="Edited text"
          setEditingDescription={setEditingDescription}
          setTempDescription={setTempDescription}
        />
      )

      const textarea = screen.getByPlaceholderText('Add a description...')

      // Press Escape
      await user.type(textarea, '{Escape}')

      // Should reset temp description to original
      expect(setTempDescription).toHaveBeenCalledWith('Original description')
      // Should exit editing mode
      expect(setEditingDescription).toHaveBeenCalledWith(false)
    })

    it('should add line break on Cmd+Enter (Mac)', () => {
      render(<TaskFieldEditors {...defaultProps} />)

      const textarea = screen.getByPlaceholderText('Add a description...')

      // Simulate Cmd+Enter
      fireEvent.keyDown(textarea, {
        key: 'Enter',
        metaKey: true
      })

      // Should NOT save (line break should be default behavior)
      expect(mockOnUpdate).not.toHaveBeenCalled()
    })

    it('should add line break on Ctrl+Enter (Windows/Linux)', () => {
      render(<TaskFieldEditors {...defaultProps} />)

      const textarea = screen.getByPlaceholderText('Add a description...')

      // Simulate Ctrl+Enter
      fireEvent.keyDown(textarea, {
        key: 'Enter',
        ctrlKey: true
      })

      // Should NOT save (line break should be default behavior)
      expect(mockOnUpdate).not.toHaveBeenCalled()
    })
  })

  describe('Display Behavior', () => {
    it('should show height matching text content when not editing', () => {
      render(
        <TaskFieldEditors
          {...defaultProps}
          editingDescription={false}
          task={{
            ...mockTask,
            description: 'Short description'
          }}
        />
      )

      // Find the description display div
      const descriptionDisplay = screen.getByText('Short description').parentElement

      // Should have min-h-0 class (height matches content, via Tailwind)
      expect(descriptionDisplay?.className).toContain('min-h-0')
    })

    it('should render line breaks correctly in display mode', () => {
      render(
        <TaskFieldEditors
          {...defaultProps}
          editingDescription={false}
          task={{
            ...mockTask,
            description: 'Line 1\nLine 2\nLine 3'
          }}
        />
      )

      // Description should render with <br> tags
      const descriptionDisplay = screen.getByText(/Line 1/).parentElement

      // Should contain HTML with br tags
      expect(descriptionDisplay?.innerHTML).toContain('<br>')
    })

    it('should show placeholder when description is empty', () => {
      render(
        <TaskFieldEditors
          {...defaultProps}
          editingDescription={false}
          task={{
            ...mockTask,
            description: null
          }}
        />
      )

      expect(screen.getByText('Click to add a description...')).toBeDefined()
    })
  })

  describe('Mobile Keyboard Handling', () => {
    it('should have mobile-friendly input attributes', () => {
      render(<TaskFieldEditors {...defaultProps} />)

      const textarea = screen.getByPlaceholderText('Add a description...') as HTMLTextAreaElement

      // Should have mobile attributes
      expect(textarea.getAttribute('inputMode')).toBe('text')
      expect(textarea.getAttribute('enterKeyHint')).toBe('done')
      expect(textarea.getAttribute('autocomplete')).toBe('off')
      expect(textarea.getAttribute('spellcheck')).toBe('true')
      expect(textarea.getAttribute('autocapitalize')).toBe('sentences')
    })

    it('should handle touch events for mobile keyboard', () => {
      render(<TaskFieldEditors {...defaultProps} />)

      const textarea = screen.getByPlaceholderText('Add a description...')

      // Simulate touch start
      fireEvent.touchStart(textarea)

      // Should track focus time
      expect((window as any)._lastFocusTime).toBeDefined()
    })

    it('should have minimum height for comfortable mobile editing', () => {
      render(<TaskFieldEditors {...defaultProps} />)

      const textarea = screen.getByPlaceholderText('Add a description...') as HTMLTextAreaElement

      // Should have minHeight for mobile (via Tailwind class)
      expect(textarea.className).toContain('min-h-[80px]')
    })

    it('should use 16px font size to prevent zoom on iOS', () => {
      render(<TaskFieldEditors {...defaultProps} />)

      const textarea = screen.getByPlaceholderText('Add a description...') as HTMLTextAreaElement

      // Should have 16px font to prevent iOS zoom (via Tailwind class)
      expect(textarea.className).toContain('text-base')
    })
  })

  describe('Helper Text', () => {
    it('should show keyboard shortcut hints when editing', () => {
      render(<TaskFieldEditors {...defaultProps} />)

      expect(screen.getByText(/Press Enter to save/)).toBeDefined()
      expect(screen.getByText(/Shift\+Enter for line breaks/)).toBeDefined()
    })

    it('should not show keyboard hints when not editing', () => {
      render(
        <TaskFieldEditors
          {...defaultProps}
          editingDescription={false}
        />
      )

      expect(screen.queryByText(/Press Enter to save/)).toBeNull()
    })
  })
})
