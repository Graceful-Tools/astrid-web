/**
 * Regression: the add-task input must be visible in the 2-column layout.
 *
 * Bug history: commit bdb5f40 ("de-dupe 2-col list header") changed MainContent's
 * header block from `display: !isMobile` to `display: is3Column`, because the
 * list title + gear were duplicated by TaskManagerHeader in 2-column. But the
 * add-task input (EnhancedTaskCreation) lives inside that same block, so it
 * disappeared in 2-column — and TaskManagerHeader has no add-task input, so the
 * layout was left with no way to add a task.
 *
 * The block hides via an inline `display:none`, so the input still exists in the
 * DOM (jsdom keeps it) — we assert visibility, not mere presence.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MainContent } from '@/components/TaskManager/MainContent/MainContent'
import type { Task, TaskList, User } from '@/types/task'

const mockUser: User = {
  id: 'user-1',
  email: 'test@example.com',
  name: 'Test User',
  image: null,
  emailVerified: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

const ownedList: TaskList = {
  id: 'list-1',
  name: 'Astrid Web To-do',
  description: 'Agent Workflow',
  color: '#3b82f6',
  ownerId: 'user-1',
  privacy: 'PRIVATE',
  publicListType: null,
  imageUrl: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  members: [],
  admins: [],
  tasks: [],
}

const mockTask: Task = {
  id: 'task-1',
  title: 'Test Task',
  description: null,
  completed: false,
  priority: 2,
  when: null,
  repeating: 'never',
  assigneeId: null,
  assignee: null,
  creatorId: 'user-1',
  creator: mockUser,
  lists: [ownedList],
  comments: [],
  attachments: [],
  createdAt: new Date(),
  updatedAt: new Date(),
}

const baseProps: any = {
  isMobile: false,
  mobileView: 'list' as const,
  selectedListId: 'list-1',
  lists: [ownedList],
  allTasks: [mockTask],
  finalFilteredTasks: [mockTask],
  effectiveSession: { user: mockUser },
  availableUsers: [mockUser],
  isViewingFromFeatured: false,
  hasProjectBoard: false,
  taskViewMode: 'list' as const,
  onTaskViewModeChange: vi.fn(),
  isSearchActive: false,
  searchValue: '',
  onSearchChange: vi.fn(),
  newFilterState: {
    filters: {
      search: { trim: () => '' },
      priority: null,
      assignee: null,
      dueDate: null,
      completed: null,
      sortBy: 'manual',
    },
    setPriority: vi.fn(),
    setAssignee: vi.fn(),
    setDueDate: vi.fn(),
    setCompleted: vi.fn(),
    setSortBy: vi.fn(),
    hasActiveFilters: false,
    clearAllFilters: vi.fn(),
  },
  selectedTaskId: '',
  showSettingsPopover: null,
  setShowSettingsPopover: vi.fn(),
  showLeaveListMenu: null,
  setShowLeaveListMenu: vi.fn(),
  editingListName: false,
  setEditingListName: vi.fn(),
  tempListName: '',
  setTempListName: vi.fn(),
  editingListDescription: false,
  setEditingListDescription: vi.fn(),
  tempListDescription: '',
  setTempListDescription: vi.fn(),
  quickTaskInput: '',
  setQuickTaskInput: vi.fn(),
  recentlyChangedList: false,
  isSessionReady: true,
  justReturnedFromTaskDetail: false,
  pullToRefresh: {
    isRefreshing: false,
    isPulling: false,
    canRefresh: false,
    pullDistance: 0,
    bindToElement: () => {},
    onTouchStart: vi.fn(),
    onTouchMove: vi.fn(),
    onTouchEnd: vi.fn(),
  },
  handleListImageClick: vi.fn(),
  handleEditListName: vi.fn(),
  handleSaveListName: vi.fn(),
  handleEditListDescription: vi.fn(),
  handleSaveListDescription: vi.fn(),
  handleLeaveList: vi.fn(),
  handleQuickTaskKeyDown: vi.fn(),
  handleAddTaskButtonClick: vi.fn(),
  handleTaskClick: vi.fn(),
  handleUpdateTask: vi.fn(),
  handleLocalUpdateTask: vi.fn(),
  handleToggleTaskComplete: vi.fn(),
  handleDeleteTask: vi.fn(),
  handleQuickCreateTask: vi.fn(),
  handleCreateNewTask: vi.fn(),
  handleCopyList: vi.fn(),
  handleCopyTask: vi.fn(),
  closeTaskDetail: vi.fn(),
  handleTaskDragStart: vi.fn(),
  handleTaskDragHover: vi.fn(),
  handleTaskDragLeaveTask: vi.fn(),
  handleTaskDragHoverEnd: vi.fn(),
  handleTaskDragEnd: vi.fn(),
  activeDragTaskId: null,
  dragTargetTaskId: null,
  dragTargetPosition: null,
  manualSortActive: false,
  manualSortPreviewActive: false,
  canEditListSettingsMemo: () => true,
  getSelectedListInfo: () => ({ name: 'Astrid Web To-do', description: '' }),
  getPriorityColor: () => '#3b82f6',
  taskManagerRef: { current: null },
  isKeyboardScrollingRef: { current: false },
  onListUpdate: vi.fn(),
  onListDelete: vi.fn(),
}

describe('Add-task input visibility across desktop layouts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is visible in the 2-column layout', () => {
    render(<MainContent {...baseProps} is2Column={true} is3Column={false} />)

    const input = screen.getByPlaceholderText(/add task/i)
    expect(input).toBeVisible()
  })

  it('stays visible in the 3-column layout', () => {
    render(<MainContent {...baseProps} is2Column={false} is3Column={true} />)

    const input = screen.getByPlaceholderText(/add task/i)
    expect(input).toBeVisible()
  })
})
