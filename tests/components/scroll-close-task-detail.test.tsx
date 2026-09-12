/**
 * Tests for scroll-to-close task detail behavior in 2-column and 3-column layouts
 *
 * Bug: Task details should close when scrolling the task list in 2-column and 3-column layouts
 * but NOT in 1-column (mobile) layouts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildTaskList } from '../fixtures/domain'
import { render, screen, fireEvent } from '@testing-library/react'
import { MainContent } from '@/components/TaskManager/MainContent/MainContent'
import type { Task, TaskList, User } from '@/types/task'

describe('Scroll-to-close task detail behavior', () => {
  const mockCloseTaskDetail = vi.fn()
  const mockUser: User = {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    image: null,
    emailVerified: null,
    createdAt: new Date(),
    updatedAt: new Date()
  }

  const mockList: TaskList = buildTaskList({
    id: 'list-1',
    name: 'Test List',
    description: 'Test description',
    color: '#3b82f6',
    ownerId: 'user-1',
    privacy: 'PRIVATE',
    publicListType: null,
    imageUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    members: [],
    admins: [],
    tasks: []
  })

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
    lists: [mockList],
    comments: [],
    attachments: [],
    createdAt: new Date(),
    updatedAt: new Date()
  }

  const mockTasks: Task[] = [
    mockTask,
    { ...mockTask, id: 'task-2', title: 'Task 2' },
    { ...mockTask, id: 'task-3', title: 'Task 3' },
    { ...mockTask, id: 'task-4', title: 'Task 4' },
    { ...mockTask, id: 'task-5', title: 'Task 5' }
  ]

  const defaultProps = {
    isMobile: false,
    mobileView: 'list' as const,
    is2Column: false,
    is3Column: false,
    selectedListId: 'list-1',
    lists: [mockList],
    finalFilteredTasks: mockTasks,
    effectiveSession: { user: mockUser },
    availableUsers: [mockUser],
    isViewingFromFeatured: false,
    newFilterState: {
      filters: {
        search: { trim: () => '' },
        priority: null,
        assignee: null,
        dueDate: null,
        completed: null,
        sortBy: 'manual'
      },
      setPriority: vi.fn(),
      setAssignee: vi.fn(),
      setDueDate: vi.fn(),
      setCompleted: vi.fn(),
      setSortBy: vi.fn(),
      hasActiveFilters: false,
      clearAllFilters: vi.fn()
    },
    selectedTaskId: 'task-1',
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
      onTouchEnd: vi.fn()
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
    handleToggleTaskComplete: vi.fn(),
    handleQuickCreateTask: vi.fn(),
    handleCreateNewTask: vi.fn(),
    handleCopyList: vi.fn(),
    handleCopyTask: vi.fn(),
    closeTaskDetail: mockCloseTaskDetail,
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
    getSelectedListInfo: () => ({ name: 'Test List', description: 'Test description' }),
    getPriorityColor: () => '#3b82f6',
    taskManagerRef: { current: null },
    isKeyboardScrollingRef: { current: false },
    onListUpdate: vi.fn(),
    onListDelete: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should close task detail on scroll in 2-column layout', () => {
    const { container } = render(
      <MainContent {...defaultProps} is2Column={true} is3Column={false} />
    )

    const taskListContainer = container.querySelector('.task-list-container')
    expect(taskListContainer).toBeTruthy()

    // Simulate scroll event
    fireEvent.scroll(taskListContainer!)

    // Should close task detail in 2-column layout
    expect(mockCloseTaskDetail).toHaveBeenCalledTimes(1)
  })

  it('should close task detail on scroll in 3-column layout', () => {
    const { container } = render(
      <MainContent {...defaultProps} is2Column={false} is3Column={true} />
    )

    const taskListContainer = container.querySelector('.task-list-container')
    expect(taskListContainer).toBeTruthy()

    // Simulate scroll event
    fireEvent.scroll(taskListContainer!)

    // Should close task detail in 3-column layout
    expect(mockCloseTaskDetail).toHaveBeenCalledTimes(1)
  })

  it('should NOT close task detail on scroll in 1-column layout', () => {
    const { container } = render(
      <MainContent {...defaultProps} isMobile={true} is2Column={false} is3Column={false} />
    )

    const taskListContainer = container.querySelector('.task-list-container')
    expect(taskListContainer).toBeTruthy()

    // Simulate scroll event
    fireEvent.scroll(taskListContainer!)

    // Should NOT close task detail in 1-column (mobile) layout
    expect(mockCloseTaskDetail).not.toHaveBeenCalled()
  })

  it('should NOT close task detail when scrolling via keyboard navigation', () => {
    const keyboardScrollRef = { current: true }
    const { container } = render(
      <MainContent
        {...defaultProps}
        is2Column={true}
        is3Column={false}
        isKeyboardScrollingRef={keyboardScrollRef}
      />
    )

    const taskListContainer = container.querySelector('.task-list-container')
    expect(taskListContainer).toBeTruthy()

    // Simulate scroll event while keyboard scrolling is active
    fireEvent.scroll(taskListContainer!)

    // Should NOT close task detail during keyboard navigation
    expect(mockCloseTaskDetail).not.toHaveBeenCalled()
  })

  it('should NOT close task detail if no task is selected', () => {
    const { container } = render(
      <MainContent
        {...defaultProps}
        is2Column={true}
        is3Column={false}
        selectedTaskId=""
      />
    )

    const taskListContainer = container.querySelector('.task-list-container')
    expect(taskListContainer).toBeTruthy()

    // Simulate scroll event
    fireEvent.scroll(taskListContainer!)

    // Should NOT close task detail if nothing is selected
    expect(mockCloseTaskDetail).not.toHaveBeenCalled()
  })

  it('should handle scroll events in both 2-column and 3-column layouts', () => {
    // Test 2-column layout
    const { container: container2col, rerender } = render(
      <MainContent {...defaultProps} is2Column={true} is3Column={false} />
    )

    const taskListContainer2col = container2col.querySelector('.task-list-container')
    fireEvent.scroll(taskListContainer2col!)
    expect(mockCloseTaskDetail).toHaveBeenCalledTimes(1)

    mockCloseTaskDetail.mockClear()

    // Test 3-column layout
    rerender(<MainContent {...defaultProps} is2Column={false} is3Column={true} />)

    const taskListContainer3col = container2col.querySelector('.task-list-container')
    fireEvent.scroll(taskListContainer3col!)
    expect(mockCloseTaskDetail).toHaveBeenCalledTimes(1)
  })
})
