import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TaskFieldEditors } from '@/components/task-detail/TaskFieldEditors'
import type { Task, TaskList, User } from '@/types/task'
import { useRef } from 'react'

// Mock components that have complex dependencies
vi.mock('@/components/user-picker', () => ({
  UserPicker: ({ onUserSelect }: any) => (
    <div data-testid="user-picker">
      <button onClick={() => onUserSelect({ id: 'user-1', name: 'Test User', email: 'test@example.com' })}>
        Select User
      </button>
    </div>
  )
}))

vi.mock('@/components/custom-repeating-editor', () => ({
  CustomRepeatingEditor: ({ onSave, onCancel }: any) => (
    <div data-testid="custom-repeating-editor">
      <button onClick={onSave}>Save Custom</button>
      <button onClick={onCancel}>Cancel Custom</button>
    </div>
  )
}))

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

describe('TaskFieldEditors', () => {
  const mockCurrentUser: User = {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    image: null
  }

  const mockTask: Task = {
    id: 'task-1',
    title: 'Test Task',
    description: 'Test description',
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

  const mockLists: TaskList[] = [
    {
      id: 'list-1',
      name: 'Work Tasks',
      color: '#3b82f6',
      privacy: 'PRIVATE' as const,
      ownerId: 'user-1',
      createdAt: new Date(),
      updatedAt: new Date()
    }
  ]

  const defaultProps = {
    task: mockTask,
    currentUser: mockCurrentUser,
    availableLists: mockLists,
    onUpdate: vi.fn(),
    onInviteUser: vi.fn(),

    // Editing state
    editingTitle: false,
    setEditingTitle: vi.fn(),
    editingDescription: false,
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

    // Refs
    assigneeRef: { current: null },
    descriptionRef: { current: null },
    descriptionTextareaRef: { current: null },

    // Temp values
    tempTitle: 'Test Task',
    setTempTitle: vi.fn(),
    tempDescription: 'Test description',
    setTempDescription: vi.fn(),
    tempWhen: undefined,
    setTempWhen: vi.fn(),
    tempPriority: 1,
    setTempPriority: vi.fn(),
    tempRepeating: 'never' as const,
    setTempRepeating: vi.fn(),
    tempRepeatingData: null,
    setTempRepeatingData: vi.fn(),

    // List selection
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

    // Assignee
    tempAssignee: null,
    setTempAssignee: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render all field editors', () => {
      render(<TaskFieldEditors {...defaultProps} />)

      // Date/Time/Repeat consolidated into one "When" row and
      // Priority/Assignee into one "Priority" row (task dcbbb0fa), so the
      // per-field labels these used to assert no longer exist.
      //
      // Each row is now identified by an ICON carrying the field name as its
      // accessible name, mirroring iOS TwoColumnRow: the icon column keeps
      // every row's content starting at the same x, and the word is redundant
      // next to a calendar chip or a coloured priority chip. Querying by
      // accessible name is what a screen reader does, so it pins the thing
      // that actually has to keep working.
      expect(screen.getByLabelText('When')).toBeInTheDocument()
      expect(screen.getByLabelText('Priority')).toBeInTheDocument()
      expect(screen.getByLabelText('Lists')).toBeInTheDocument()
      expect(screen.getByLabelText('Description')).toBeInTheDocument()
    })

    it('should show unassigned when no assignee', () => {
      render(<TaskFieldEditors {...defaultProps} />)
      expect(screen.getByText('Unassigned')).toBeInTheDocument()
    })

    it('should show assignee name when assigned', () => {
      const taskWithAssignee = {
        ...mockTask,
        assignee: mockCurrentUser,
        assigneeId: mockCurrentUser.id
      }
      render(<TaskFieldEditors {...defaultProps} task={taskWithAssignee} />)
      expect(screen.getByText('Test User')).toBeInTheDocument()
    })

    it('should show "No date" when when is not set', () => {
      render(<TaskFieldEditors {...defaultProps} />)
      expect(screen.getByText('No date')).toBeInTheDocument()
    })

    it('should show "No lists" when no lists assigned', () => {
      render(<TaskFieldEditors {...defaultProps} />)
      expect(screen.getByText('No lists')).toBeInTheDocument()
    })
  })

  describe('Assignee Editing', () => {
    it('should show UserPicker when editing assignee', () => {
      render(<TaskFieldEditors {...defaultProps} editingAssignee={true} />)
      expect(screen.getByTestId('user-picker')).toBeInTheDocument()
    })

    it('should call onUpdate when assignee is selected', () => {
      const onUpdate = vi.fn()
      render(<TaskFieldEditors {...defaultProps} editingAssignee={true} onUpdate={onUpdate} />)

      fireEvent.click(screen.getByText('Select User'))

      expect(onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          assignee: expect.objectContaining({ id: 'user-1' }),
          assigneeId: 'user-1'
        })
      )
    })

    it('should hide assignee field for public lists', () => {
      const taskInPublicList = {
        ...mockTask,
        lists: [{ ...mockLists[0], privacy: 'PUBLIC' as const }]
      }
      render(<TaskFieldEditors {...defaultProps} task={taskInPublicList} shouldHidePriority={true} />)
      // Assignee field should not be present for public list tasks
      expect(screen.queryByText('Assignee')).not.toBeInTheDocument()
    })
  })

  describe('Description Editing', () => {
    it('should show textarea when editing description', () => {
      render(<TaskFieldEditors {...defaultProps} editingDescription={true} />)
      expect(screen.getByPlaceholderText('Add a description...')).toBeInTheDocument()
    })

    it('should call onUpdate when description is saved on Enter key', () => {
      const onUpdate = vi.fn()

      render(<TaskFieldEditors
        {...defaultProps}
        editingDescription={true}
        onUpdate={onUpdate}
        tempDescription="Updated description"
      />)

      const textarea = screen.getByPlaceholderText('Add a description...')

      // Press Enter to save
      fireEvent.keyDown(textarea, { key: 'Enter' })

      expect(onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'Updated description' })
      )
    })
  })

  describe('Lists Editing', () => {
    it('should show list search when editing lists', () => {
      render(<TaskFieldEditors {...defaultProps} editingLists={true} />)
      expect(screen.getByPlaceholderText('Search lists...')).toBeInTheDocument()
    })

    it('should save lists when Save button is clicked', () => {
      const onUpdate = vi.fn()
      const setEditingLists = vi.fn()

      render(<TaskFieldEditors
        {...defaultProps}
        editingLists={true}
        onUpdate={onUpdate}
        setEditingLists={setEditingLists}
      />)

      fireEvent.click(screen.getByText('Save'))

      expect(onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ lists: [] })
      )
      expect(setEditingLists).toHaveBeenCalledWith(false)
    })
  })

  describe('When row — Date · Time · Repeat (dcbbb0fa)', () => {
    it('shows the date control alone when no date is set', () => {
      // An undated task gets a single "Add date" control, not three empty ones.
      render(<TaskFieldEditors {...defaultProps} />)
      expect(screen.getByTestId('when-date')).toBeInTheDocument()
      expect(screen.queryByTestId('when-time')).not.toBeInTheDocument()
      expect(screen.queryByTestId('when-repeat')).not.toBeInTheDocument()
    })

    it('should not show time field when dueDateTime is not set', () => {
      render(<TaskFieldEditors {...defaultProps} />)
      expect(screen.queryByTestId('when-time')).not.toBeInTheDocument()
    })

    it('should show time field when dueDateTime is set', () => {
      const taskWithDate = {
        ...mockTask,
        dueDateTime: new Date('2025-12-25T10:00:00'),
        isAllDay: false
      }
      render(<TaskFieldEditors {...defaultProps} task={taskWithDate} tempWhen={taskWithDate.dueDateTime} />)
      expect(screen.getByTestId('when-time')).toBeInTheDocument()
    })
  })

  describe('Repeating Field', () => {
    it('should not show repeating field when dueDateTime is not set', () => {
      render(<TaskFieldEditors {...defaultProps} />)
      expect(screen.queryByTestId('when-repeat')).not.toBeInTheDocument()
    })

    it('should show repeating field when dueDateTime is set', () => {
      const taskWithDate = {
        ...mockTask,
        dueDateTime: new Date('2025-12-25T10:00:00'),
        isAllDay: false
      }
      render(<TaskFieldEditors {...defaultProps} task={taskWithDate} tempWhen={taskWithDate.dueDateTime} />)
      expect(screen.getByTestId('when-repeat')).toBeInTheDocument()
    })
  })

  describe('Helper Functions', () => {
    it('should format custom repeating summary correctly', () => {
      const taskWithDate = {
        ...mockTask,
        dueDateTime: new Date('2025-12-25T10:00:00'),
        isAllDay: false,
        repeating: 'custom' as const,
        repeatingData: {
          type: 'custom' as const,
          unit: 'weeks' as const,
          interval: 2,
          weekdays: ['monday', 'wednesday', 'friday'],
          endCondition: 'never' as const
        }
      }

      render(<TaskFieldEditors
        {...defaultProps}
        task={taskWithDate}
        tempWhen={taskWithDate.dueDateTime}
        tempRepeating="custom"
        tempRepeatingData={taskWithDate.repeatingData}
      />)

      // The component should display the custom summary (weekdays are abbreviated to 3 letters)
      expect(screen.getByText(/Every 2 weeks on Mon, Wed, Fri/i)).toBeInTheDocument()
    })
  })
})
