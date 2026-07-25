/**
 * Regression: the list-header settings/filter button must stay inside the
 * center column. In a 3-column layout with a project board the header action
 * row holds the List/Board toggle AND the settings gear; without shrink
 * protection the flex row's min-content exceeds the column width and the gear
 * spills past the column's right border into the chat/detail column.
 *
 * jsdom can't compute layout, so we lock in the load-bearing containment
 * contract instead: the flexible title block must be allowed to shrink
 * (min-w-0) and the action-button cluster must not (flex-shrink-0), so the
 * title yields space and the buttons stay put.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
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

const boardList: TaskList = {
  id: 'list-1',
  name: 'Astrid Web To-do',
  description: 'Astrid Web — Agent Workflow',
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
  lists: [boardList],
  comments: [],
  attachments: [],
  createdAt: new Date(),
  updatedAt: new Date(),
}

const defaultProps: any = {
  isMobile: false,
  mobileView: 'list' as const,
  is2Column: false,
  is3Column: true,
  selectedListId: 'list-1',
  lists: [boardList],
  allTasks: [mockTask],
  finalFilteredTasks: [mockTask],
  effectiveSession: { user: mockUser },
  availableUsers: [mockUser],
  isViewingFromFeatured: false,
  hasProjectBoard: true,
  taskViewMode: 'list' as const,
  onTaskViewModeChange: vi.fn(),
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

describe('List header settings button stays inside the center column', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the settings button inside a shrink-protected action cluster', () => {
    const { container } = render(<MainContent {...defaultProps} />)

    const settingsButton = container.querySelector('[data-settings-button="true"]')
    expect(settingsButton).toBeTruthy()

    // The action cluster (List/Board toggle + gear) must not be squeezed —
    // otherwise the last item (the gear) is what overflows.
    const actionCluster = settingsButton!.parentElement
    expect(actionCluster).toBeTruthy()
    expect(actionCluster!.className).toContain('flex-shrink-0')
  })

  it('lets the flexible title block shrink so the buttons stay put', () => {
    const { container } = render(<MainContent {...defaultProps} />)

    // The editable name/description block grows to fill the header (flex-1).
    // It must be allowed to shrink below its content width (min-w-0) so the
    // action cluster is never pushed past the column edge.
    const titleBlock = container.querySelector('.flex-1.text-left')
    expect(titleBlock).toBeTruthy()
    expect(titleBlock!.className).toContain('min-w-0')
  })
})
