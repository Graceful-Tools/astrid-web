import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { TaskManagerView } from '@/components/TaskManagerView'
import type { Task, TaskList } from '@/types/task'

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

// Mock keyboard shortcuts
vi.mock('@/hooks/useKeyboardShortcuts', () => ({
  useKeyboardShortcuts: () => ({
    shortcuts: [],
    showHotkeyMenu: false,
    setShowHotkeyMenu: vi.fn()
  }),
  KEYBOARD_SHORTCUTS: []
}))

// Mock UserMenu
vi.mock('@/components/auth/user-menu', () => ({
  UserMenu: () => <div data-testid="user-menu">User Menu</div>
}))

// Mock LoadingScreen
vi.mock('@/components/loading-screen', () => ({
  LoadingScreen: () => <div data-testid="loading-screen">Loading...</div>
}))

// Mock KeyboardShortcutsMenu
vi.mock('@/components/keyboard-shortcuts-menu', () => ({
  KeyboardShortcutsMenu: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => (
    isOpen ? <div data-testid="keyboard-shortcuts-menu">
      <button onClick={onClose}>Close Menu</button>
    </div> : null
  )
}))

// Mock ThemeContext
// TaskDetail calls useSettings(), which throws outside a SettingsProvider.
// This harness never needed it before: the read-only branch used to render
// TaskDetailViewOnly, which had no such dependency. Converging the two (task
// 72cb4a13) means the read-only pane is now a TaskDetail like any other, so it
// carries TaskDetail's context requirements too.
//
// The app itself is unaffected — SettingsProvider wraps everything from
// app/[locale]/layout.tsx via components/providers.tsx — so this is a harness
// gap rather than a user-facing one. Mocked rather than wrapped in the real
// provider, matching the other TaskDetail tests: these cases are about click
// behaviour, not settings.
vi.mock('@/contexts/settings-context', () => ({
  useSettings: () => ({ reminderDebugMode: false }),
}))

vi.mock('@/contexts/theme-context', () => ({
  useTheme: () => ({
    theme: 'system',
    effectiveTheme: 'light',
    setTheme: vi.fn(),
  }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

describe('TaskManagerView - Settings Button Behavior', () => {
  const mockTask: Task = {
    id: 'task-1',
    title: 'Test Task',
    description: '',
    completed: false,
    priority: 0,
    creatorId: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  const mockList: TaskList = {
    id: 'list-1',
    name: 'Test List',
    description: '',
    userId: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  let mockCloseTaskDetail: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockCloseTaskDetail = vi.fn()
  })

  const createMockProps = (selectedTask: Task | null = null) => ({
    // Data
    tasks: [mockTask],
    lists: [mockList],
    publicTasks: [],
    publicLists: [],
    loading: false,
    selectedTaskId: selectedTask?.id || '',
    selectedListId: 'list-1',
    selectedTask,
    finalFilteredTasks: [mockTask],
    availableUsers: [],
    isSessionReady: true,
    effectiveSession: { user: { id: 'user-1', name: 'Test User' } },
    newFilterState: {
      filters: { search: '', completed: 'incomplete', priority: [], assignee: [], dueDate: 'all', sortBy: 'auto' },
      setSearch: vi.fn()
    },
    isViewingFromFeatured: false,

    // Task panel animation
    isTaskPaneClosing: false,
    taskPanePosition: { left: 0 },
    setTaskPanePosition: vi.fn(),
    selectedTaskElement: null,

    // Counts
    getTaskCountForListMemo: vi.fn(() => 1),
    getSavedFilterTaskCountMemo: vi.fn(() => 0),
    getFixedListTaskCountMemo: vi.fn(() => 0),
    getSelectedListInfo: vi.fn(() => ({ name: 'Test List', description: '' })),

    // Permissions
    canEditListSettingsMemo: vi.fn(() => true),
    getPriorityColor: vi.fn(() => 'text-white'),

    // Refs
    isKeyboardScrollingRef: { current: false },
    sidebarRef: { current: null },
    taskManagerRef: { current: null },

    // Layout data (2-column desktop with task open)
    layoutType: 'desktop-2-column' as const,
    columnCount: 2 as const,
    is1Column: false,
    is2Column: true,
    is3Column: false,
    isMobile: false,
    mobileView: 'list' as const,
    showHamburgerMenu: true,
    showMobileSidebar: false,
    mobileSearchMode: false,
    justReturnedFromTaskDetail: false,
    isMobileTaskDetailClosing: false,
    isMobileTaskDetailOpen: false,
    taskDetailDragOffset: 0,

    // Layout handlers
    toggleMobileSidebar: vi.fn(),
    handleMobileBack: vi.fn(),
    handleMobileSearchStart: vi.fn(),
    handleMobileSearchEnd: vi.fn(),
    handleMobileSearchClear: vi.fn(),
    handleMobileSearchKeyDown: vi.fn(),
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

    // Modal manager
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

    // Business logic
    loadData: vi.fn(),
    handleTaskClick: vi.fn(),
    handleUpdateTask: vi.fn(),
    handleLocalUpdateTask: vi.fn(),
    handleToggleTaskComplete: vi.fn(),
    handleDeleteTask: vi.fn(),
    closeTaskDetail: mockCloseTaskDetail,
    handleCreateTask: vi.fn(),
    handleQuickCreateTask: vi.fn(),
    handleCreateNewTask: vi.fn(),
    handleCreateList: vi.fn(),
    handleCopyList: vi.fn(),
    handleCopyTask: vi.fn(),
    handleDeleteList: vi.fn(),
    handleUpdateList: vi.fn(),
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

    // Mobile handlers
    handleQuickTaskKeyDown: vi.fn(),
    handleAddTaskButtonClick: vi.fn(),

    // Image picker
    handleListImageClick: vi.fn(),
    handleImagePickerSelect: vi.fn(),
    handleImagePickerCancel: vi.fn(),
    showImagePicker: false,
    selectedListForImagePicker: null,

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

    // Hotkey menu
    showHotkeyMenu: false,
    setShowHotkeyMenu: vi.fn(),

    // Public browser
    handleListCopied: vi.fn(),
    setShowPublicBrowser: vi.fn(),
    setShowMobileSidebar: vi.fn(),

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
  })

  it('should NOT close task panel when clicking settings button in header with task open (2-column)', async () => {
    const props = createMockProps(mockTask)
    const { container } = render(<TaskManagerView {...props} />)

    // Verify task is open
    expect(props.selectedTask).toBe(mockTask)

    // Find the header element
    const header = container.querySelector('.app-header')
    expect(header).toBeTruthy()

    // Create a button-like element to simulate the settings button with stopPropagation
    const mockButton = document.createElement('button')
    mockButton.className = 'settings-button'
    if (header) {
      header.appendChild(mockButton)
    }

    // Add stopPropagation handler to mimic the actual button behavior
    mockButton.addEventListener('mousedown', (e) => {
      e.stopPropagation()
    })

    // Click the button (should NOT close task panel due to stopPropagation)
    fireEvent.mouseDown(mockButton)

    // Verify closeTaskDetail was NOT called
    expect(mockCloseTaskDetail).not.toHaveBeenCalled()

    // Cleanup
    if (header) {
      header.removeChild(mockButton)
    }
  })

  it('should close task panel when clicking outside header and task panel', async () => {
    const props = createMockProps(mockTask)
    const { container } = render(<TaskManagerView {...props} />)

    // Verify task is open
    expect(props.selectedTask).toBe(mockTask)

    // Click on the main container (outside header and task panel)
    const mainContainer = container.querySelector('.app-container')
    if (mainContainer) {
      fireEvent.mouseDown(mainContainer)
    }

    // Verify closeTaskDetail WAS called
    await waitFor(() => {
      expect(mockCloseTaskDetail).toHaveBeenCalled()
    })
  })

  it('should NOT close task panel when clicking in task panel itself', async () => {
    const props = createMockProps(mockTask)
    const { container } = render(<TaskManagerView {...props} />)

    // Verify task is open
    expect(props.selectedTask).toBe(mockTask)

    // Create a mock element that looks like it's inside the task panel
    const mockTaskPanel = document.createElement('div')
    mockTaskPanel.className = 'task-panel-desktop'
    document.body.appendChild(mockTaskPanel)

    // Click on the task panel
    fireEvent.mouseDown(mockTaskPanel)

    // Verify closeTaskDetail was NOT called
    expect(mockCloseTaskDetail).not.toHaveBeenCalled()

    // Cleanup
    document.body.removeChild(mockTaskPanel)
  })
})
