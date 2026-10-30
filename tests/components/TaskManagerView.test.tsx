import { render, screen, fireEvent } from '@testing-library/react'
import type { Task } from '@/types/task'
import { buildTask } from '../fixtures/domain'
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

// Mock LoadingScreen
vi.mock('@/components/loading-screen', () => ({
  LoadingScreen: () => <div data-testid="loading-screen">Loading...</div>
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
    // The whole useFilterState return, not just setSearch: the other nine
    // members are required and were never supplied (AWTD-916).
    newFilterState: {
      filters: {
        search: '',
        completed: 'incomplete' as const,
        priority: [] as number[],
        assignee: [] as string[],
        dueDate: 'all' as const,
        sortBy: 'auto' as const,
      },
      hasActiveFilters: false,
      setSearch: vi.fn(),
      setCompleted: vi.fn(),
      setPriority: vi.fn(),
      setAssignee: vi.fn(),
      setDueDate: vi.fn(),
      setSortBy: vi.fn(),
      clearAllFilters: vi.fn(),
      applyFiltersToTasks: vi.fn((tasks: Task[]) => tasks),
      isMyTasks: false,
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
    layoutType: 'computer-3-column' as const,
    columnCount: 3 as const,
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
    showSortFiltersFor: null,
    setShowSortFiltersFor: vi.fn(),
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

    // ---------------------------------------------------------------------
    // Required by TaskManagerViewModel and never supplied (AWTD-916). The
    // suite renders TaskManagerView as a pure controlled component, so every
    // one of these is a prop the real caller passes and the test did not.
    // ---------------------------------------------------------------------

    // Public lists
    publicLists: [],
    collaborativePublicLists: [],
    suggestedPublicLists: [],
    isViewingFromFeatured: false,

    // Settings / search navigation
    activeView: 'list' as const,
    settingsPage: null,
    isSettingsActive: false,
    settingsSubPage: null,
    isSearchActive: false,
    onNavigateSettings: vi.fn(),
    onExitSettings: vi.fn(),
    onCloseSettingsSubPage: vi.fn(),
    onSelectSearch: vi.fn(),
    onExitSearch: vi.fn(),

    // Swipe
    swipeHandlers: {
      onTouchStart: vi.fn(),
      onTouchMove: vi.fn(),
      onTouchEnd: vi.fn(),
    },
    sidebarSwipeToDismiss: {
      onTouchStart: vi.fn(),
      onTouchMove: vi.fn(),
      onTouchEnd: vi.fn(),
    },
    taskDetailSwipeToDismiss: {
      onTouchStart: vi.fn(),
      onTouchMove: vi.fn(),
      onTouchEnd: vi.fn(),
    },

    // Display mode
    taskDisplayMode: 'list' as const,
    handleToggleListFavorite: vi.fn(),

    // Drag and manual sort
    handleTaskDragHover: vi.fn(),
    handleTaskDragLeaveTask: vi.fn(),
    handleTaskDragHoverEnd: vi.fn(),
    dragTargetTaskId: null,
    dragTargetPosition: null,
    manualSortActive: false,
    manualSortPreviewActive: false,
    promoteTargetVisible: false,
    handleTaskDropOnPromoteTarget: vi.fn(),
    handleOutdentTask: vi.fn(),
    handleIndentTask: vi.fn(),

    // Chat panel
    activePanel: 'tasks' as const,
    setActivePanel: vi.fn(),
    chatChannelId: null,
    chatListMembers: [],
    hasProjectBoard: false,
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

    it('reloads data once when the brand logo is clicked, without changing the list', () => {
      render(<TaskManagerView {...mockProps} />)
      expect(mockProps.loadData).not.toHaveBeenCalled()

      fireEvent.click(screen.getByTitle('Go to Home'))

      expect(mockProps.loadData).toHaveBeenCalledTimes(1)
      expect(mockProps.setSelectedListId).not.toHaveBeenCalled()
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
          layoutType="computer-1-column"
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
  })

  describe('React Native Compatibility', () => {
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
    it('is wrapped in React.memo', () => {
      expect((TaskManagerView as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for('react.memo'))
    })

    it('renders the tasks it is given as props', () => {
      const customTasks = [
        buildTask({ id: '1', title: 'Custom Task', completed: false }),
      ]

      render(<TaskManagerView {...mockProps} tasks={customTasks} finalFilteredTasks={customTasks} />)

      expect(screen.getByText('Custom Task')).toBeInTheDocument()
    })
  })
})
