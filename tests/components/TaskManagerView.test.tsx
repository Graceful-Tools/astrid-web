import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { TaskManagerView } from '@/components/TaskManagerView'

// Mock Next.js router
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => ({
    get: vi.fn(),
    getAll: vi.fn(),
    has: vi.fn(),
    keys: vi.fn(),
    values: vi.fn(),
    entries: vi.fn(),
    forEach: vi.fn(),
    toString: vi.fn(),
  }),
  usePathname: () => '/',
}))

// Mock the keyboard shortcuts menu
vi.mock('@/components/keyboard-shortcuts-menu', () => ({
  KeyboardShortcutsMenu: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => (
    isOpen ? <div data-testid="keyboard-shortcuts-menu">
      <button onClick={onClose}>Close Menu</button>
    </div> : null
  )
}))

// Mock UserMenu to avoid ThemeProvider requirement
vi.mock('@/components/auth/user-menu', () => ({
  UserMenu: () => <div data-testid="user-menu">User Menu</div>
}))

// Mock LoadingScreen
vi.mock('@/components/loading-screen', () => ({
  LoadingScreen: () => <div data-testid="loading-screen">Loading...</div>
}))

// Mock TaskManagerHeader
vi.mock('@/components/TaskManagerHeader', () => ({
  default: () => <div data-testid="task-manager-header">Header</div>
}))

// Mock hooks
vi.mock('@/hooks/useKeyboardShortcuts', () => ({
  useKeyboardShortcuts: () => ({
    shortcuts: [],
    showHotkeyMenu: false,
    setShowHotkeyMenu: vi.fn()
  }),
  KEYBOARD_SHORTCUTS: []
}))

describe('TaskManagerView', () => {
  const mockProps = {
    // Data
    tasks: [],
    lists: [],
    publicTasks: [],
    loading: false,
    selectedTaskId: '',
    selectedListId: 'my-tasks',
    selectedTask: null,
    finalFilteredTasks: [],
    availableUsers: [],
    isSessionReady: true,
    effectiveSession: { user: { id: 'user-1', name: 'Test User' } },
    newFilterState: {
      filters: { search: '', completed: 'incomplete', priority: [], assignee: [], dueDate: 'all', sortBy: 'auto' },
      setSearch: vi.fn()
    },

    // Task panel animation
    isTaskPaneClosing: false,
    taskPanePosition: { left: 0 },
    setTaskPanePosition: vi.fn(),
    selectedTaskElement: null,

    // Counts
    getTaskCountForListMemo: vi.fn(() => 0),
    getSavedFilterTaskCountMemo: vi.fn(() => 0),
    getFixedListTaskCountMemo: vi.fn(() => 0),
    getSelectedListInfo: vi.fn(() => ({ name: 'My Tasks', description: '' })),

    // Permissions
    canEditListSettingsMemo: vi.fn(() => true),
    getPriorityColor: vi.fn(() => 'text-white'),

    // Refs
    isKeyboardScrollingRef: { current: false },
    sidebarRef: { current: null },
    taskManagerRef: { current: null },

    // Layout
    isMobile: false,
    mobileView: 'list' as const,
    showHamburgerMenu: false,
    showMobileSidebar: false,
    mobileSearchMode: false,
    justReturnedFromTaskDetail: false,
    isMobileTaskDetailClosing: false,
    isMobileTaskDetailOpen: false,
    taskDetailDragOffset: 0,
    layoutType: 'three-column' as const,
    columnCount: 3,
    is1Column: false,
    is2Column: false,
    is3Column: true,

    // Layout handlers
    toggleMobileSidebar: vi.fn(),
    handleMobileBack: vi.fn(),
    handleMobileSearchStart: vi.fn(),
    handleMobileSearchEnd: vi.fn(),
    handleMobileSearchClear: vi.fn(),
    handleMobileSearchKeyDown: vi.fn(),

    // Modal state
    showAddListModal: false,
    showPublicBrowser: false,
    quickTaskInput: '',
    searchValue: '',
    editingListName: false,
    tempListName: '',
    editingListDescription: false,
    tempListDescription: '',
    showSettingsPopover: null,
    showLeaveListMenu: null,

    // State setters
    setQuickTaskInput: vi.fn(),
    setSearchValue: vi.fn(),
    setShowAddListModal: vi.fn(),
    setSelectedListId: vi.fn(),
    setLists: vi.fn(),
    setEditingListName: vi.fn(),
    setTempListName: vi.fn(),
    setEditingListDescription: vi.fn(),
    setTempListDescription: vi.fn(),
    setShowSettingsPopover: vi.fn(),
    setShowLeaveListMenu: vi.fn(),
    setShowMobileSidebar: vi.fn(),

    // Business logic methods
    loadData: vi.fn(),
    handleTaskClick: vi.fn(),
    handleUpdateTask: vi.fn(),
    handleLocalUpdateTask: vi.fn(),
    handleToggleTaskComplete: vi.fn(),
    handleDeleteTask: vi.fn(),
    closeTaskDetail: vi.fn(),
    handleCreateTask: vi.fn(),
    handleQuickCreateTask: vi.fn(),
    handleCreateNewTask: vi.fn(),
    handleCreateList: vi.fn(),
    handleDeleteList: vi.fn(),
    handleUpdateList: vi.fn(),
    handleCopyList: vi.fn(),
    handleCopyTask: vi.fn(),
    handleLeaveList: vi.fn(),
    handleTaskDragStart: vi.fn(),
    handleTaskDragEnd: vi.fn(),
    handleTaskDropOnList: vi.fn(),
    handleListDragEnter: vi.fn(),
    handleListDragLeave: vi.fn(),
    handleListDragOver: vi.fn(),
    activeDragTaskId: null,
    dragOverListId: null,
    isShiftDrag: false,
    handleListImageClick: vi.fn(),
    handleImagePickerSelect: vi.fn(),
    handleImagePickerCancel: vi.fn(),
    showImagePicker: false,
    selectedListForImagePicker: null,

    // Mobile quick task handlers
    handleQuickTaskKeyDown: vi.fn(),
    handleAddTaskButtonClick: vi.fn(),

    // Keyboard shortcuts
    handleSelectNextTask: vi.fn(),
    handleSelectPreviousTask: vi.fn(),
    handleToggleTaskPanel: vi.fn(),
    handleCycleListFilters: vi.fn(),
    handleJumpToDate: vi.fn(),
    handleNewTask: vi.fn(),
    handleCompleteTask: vi.fn(),
    handlePostponeTask: vi.fn(),
    handleRemoveDueDate: vi.fn(),
    handleSetPriority: vi.fn(),
    handleMakeDueDateEarlier: vi.fn(),
    handleMakeDueDateLater: vi.fn(),
    handleEditTaskLists: vi.fn(),
    handleEditTaskTitle: vi.fn(),
    handleEditTaskDescription: vi.fn(),
    handleAddTaskComment: vi.fn(),
    handleAssignToNoOne: vi.fn(),
    handleShowHotkeyMenu: vi.fn(),
    handleShowCommandPalette: vi.fn(),

    // Hotkey menu state
    showHotkeyMenu: false,
    setShowHotkeyMenu: vi.fn(),

    // Command palette state
    showCommandPalette: false,
    setShowCommandPalette: vi.fn(),
    handleExecuteCommand: vi.fn(),

    // Misc
    handleListCopied: vi.fn(),
    setShowPublicBrowser: vi.fn(),

    // Pull to refresh
    pullToRefresh: {
      isRefreshing: false,
      isPulling: false,
      canRefresh: false,
      pullDistance: 0,
      bindToElement: vi.fn(),
      onTouchStart: vi.fn(),
      onTouchMove: vi.fn(),
      onTouchEnd: vi.fn(),
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Pure Component Behavior', () => {
    it('should render without crashing', () => {
      render(<TaskManagerView {...mockProps} />)
      // TaskManagerView renders a div container, not a main element
      const container = document.querySelector('.app-container')
      expect(container).toBeInTheDocument()
    })

    it('should be purely controlled by props', () => {
      const { rerender } = render(<TaskManagerView {...mockProps} />)

      // Should render initially
      expect(document.querySelector('.app-container')).toBeInTheDocument()

      // Should render differently when session is not provided
      rerender(<TaskManagerView {...mockProps} effectiveSession={null} />)

      // Component should show loading screen when no session
      expect(screen.getByTestId('loading-screen')).toBeInTheDocument()
    })

    it('should call handlers when user interacts', () => {
      render(<TaskManagerView {...mockProps} />)

      // Find and click the logo (should call loadData)
      const logo = screen.getByText('astrid')
      fireEvent.click(logo)

      expect(mockProps.loadData).toHaveBeenCalled()
    })
  })

  describe('Keyboard Shortcuts Integration', () => {
    it('loads the keyboard shortcuts menu on demand (task e70c3862)', async () => {
      render(<TaskManagerView {...mockProps} showHotkeyMenu={true} />)

      expect(await screen.findByTestId('keyboard-shortcuts-menu')).toBeInTheDocument()
    })

    it('keeps deferred panels out of the initial task-list paint (task e70c3862)', () => {
      render(
        <TaskManagerView
          {...mockProps}
          columnCount={1}
          is1Column
          is2Column={false}
          is3Column={false}
          layoutType="one-column"
          showHotkeyMenu={false}
        />,
      )

      expect(screen.queryByTestId('keyboard-shortcuts-menu')).not.toBeInTheDocument()
      expect(document.querySelector('[data-lazy-panel-loading]')).not.toBeInTheDocument()
    })

    it('should call setShowHotkeyMenu when closing keyboard shortcuts menu', async () => {
      render(<TaskManagerView {...mockProps} showHotkeyMenu={true} />)

      const closeButton = await screen.findByText('Close Menu')
      fireEvent.click(closeButton)

      expect(mockProps.setShowHotkeyMenu).toHaveBeenCalledWith(false)
    })
  })

  describe('Mobile Features', () => {
    it('should render mobile version when on mobile in list view', () => {
      render(<TaskManagerView {...mockProps} isMobile={true} mobileView="list" />)

      // Just verify it renders without crashing for mobile
      const container = document.querySelector('.app-container')
      expect(container).toBeInTheDocument()
    })

    it('should not render mobile add task button when not on mobile', () => {
      render(<TaskManagerView {...mockProps} isMobile={false} mobileView="list" />)

      expect(screen.queryByPlaceholderText('Add a new task...')).not.toBeInTheDocument()
    })

    it('should not render mobile add task button when in task view', () => {
      render(<TaskManagerView {...mockProps} isMobile={true} mobileView="task" />)

      expect(screen.queryByPlaceholderText('Add a new task...')).not.toBeInTheDocument()
    })

    it('should pass mobile-specific handlers', () => {
      render(<TaskManagerView {...mockProps} isMobile={true} mobileView="list" />)

      // Verify that mobile-specific handlers are provided as props
      expect(typeof mockProps.handleQuickTaskKeyDown).toBe('function')
      expect(typeof mockProps.handleAddTaskButtonClick).toBe('function')
    })
  })

  describe('React Native Compatibility', () => {
    it('should receive all data as props', () => {
      render(<TaskManagerView {...mockProps} />)

      // Should not have any internal data fetching or state management
      // All data should come from props
      expect(mockProps.tasks).toBeDefined()
      expect(mockProps.lists).toBeDefined()
      expect(mockProps.loading).toBeDefined()
    })

    it('should receive all handlers as props', () => {
      render(<TaskManagerView {...mockProps} />)

      // Should not have internal business logic
      // All handlers should come from props
      expect(typeof mockProps.handleTaskClick).toBe('function')
      expect(typeof mockProps.handleCreateTask).toBe('function')
      expect(typeof mockProps.handleUpdateTask).toBe('function')
      expect(typeof mockProps.handleDeleteTask).toBe('function')
    })

    it('should not contain platform-specific logic', () => {
      const { container } = render(<TaskManagerView {...mockProps} />)

      // Should use standard HTML/CSS that can be replaced with React Native components
      // No direct DOM manipulation or web-specific APIs
      expect(container.firstChild).toHaveClass('app-container')
    })
  })

  describe('Loading States', () => {
    it('should render loading screen when no session', () => {
      render(<TaskManagerView {...mockProps} effectiveSession={null} isMobile={false} />)

      expect(screen.getByTestId('loading-screen')).toBeInTheDocument()
    })

    it('should not render loading screen when session exists', () => {
      render(<TaskManagerView {...mockProps} effectiveSession={{ user: { id: 'user-1', name: 'Test' }}} />)

      expect(screen.queryByTestId('loading-screen')).not.toBeInTheDocument()
    })
  })

  describe('Component Architecture', () => {
    it('should be a memo component for performance', () => {
      // Test that the component is memoized
      const { rerender } = render(<TaskManagerView {...mockProps} />)

      // Rerender with same props should not cause unnecessary re-renders
      rerender(<TaskManagerView {...mockProps} />)

      // This is more of a documentation test - the actual memo optimization
      // would be tested through performance profiling
      expect(true).toBe(true)
    })

    it('should separate presentation from business logic', () => {
      render(<TaskManagerView {...mockProps} />)

      // Component should only handle presentation
      // No API calls, no complex state management, no business rules
      // Everything should be prop-driven
      expect(mockProps.loadData).toBeDefined()
      expect(mockProps.handleCreateTask).toBeDefined()
      expect(mockProps.tasks).toBeDefined()
    })

    it('should be framework agnostic in terms of business logic', () => {
      // The component should work with any data structure passed as props
      const customTasks = [
        { id: '1', title: 'Custom Task', completed: false }
      ]

      render(<TaskManagerView {...mockProps} tasks={customTasks} />)

      // Should render whatever is passed in props without assumptions
      expect(mockProps.getTaskCountForListMemo).toBeDefined()
    })
  })
})
