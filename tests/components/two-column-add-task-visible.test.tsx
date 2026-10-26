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
import { buildTask, buildUser } from '../fixtures/domain'
import { buildTaskList } from '../fixtures/domain'
import { render, screen, fireEvent } from '@testing-library/react'
import { MainContent } from '@/components/TaskManager/MainContent/MainContent'
import type { Task, TaskList, User } from '@/types/task'

const mockUser: User = buildUser({
  id: 'user-1',
  email: 'test@example.com',
  name: 'Test User',
  image: null,
  createdAt: new Date(),
})

const ownedList: TaskList = buildTaskList({
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
})

const mockTask: Task = buildTask({
  id: 'task-1',
  title: 'Test Task',
  description: '',
  completed: false,
  priority: 2,
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
})

const baseProps: any = {
  isMobile: false,
  // The layout MainContent now reads to decide where Sort & Filters lives
  // (AWTD-1175). This file's default case is the 2-column one; the 3-column
  // renders below override it, as they already override the booleans.
  columnCount: 2,
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
    render(<MainContent {...baseProps} />)

    const input = screen.getByPlaceholderText(/add a task/i)
    expect(input).toBeVisible()
  })

  it('stays visible in the 3-column layout', () => {
    render(<MainContent {...baseProps} columnCount={3} />)

    const input = screen.getByPlaceholderText(/add a task/i)
    expect(input).toBeVisible()
  })

  // Reuse pilot (docs/CODE_REUSE_AND_CONSISTENCY.md): the add-task gate must
  // trust the single permission source (canEditListSettingsMemo) instead of
  // re-deriving owner/admin from raw list fields. On a PUBLIC list, a user who
  // is admin via listMembers — but not the owner and not in the legacy `admins`
  // array — should see the add-task input, not the "Copy List" button. The old
  // inline check (ownerId === / admins.some) got this wrong.
  it('shows add-task (not Copy List) for an admin whom the permission source approves on a public list', () => {
    const publicListAdminViaMembers: TaskList = buildTaskList({
      ...ownedList,
      id: 'list-2',
      ownerId: 'someone-else',
      privacy: 'PUBLIC',
      publicListType: 'copy_only',
      admins: [], // legacy array does NOT list the user
      listMembers: [{ userId: 'user-1', role: 'admin', user: mockUser } as any],
    })

    render(
      <MainContent
        {...baseProps}
        columnCount={3}
        lists={[publicListAdminViaMembers]}
        selectedListId="list-2"
        // The canonical permission helper approves this user (admin via members).
        canEditListSettingsMemo={() => true}
      />,
    )

    expect(screen.getByPlaceholderText(/add a task/i)).toBeVisible()
    expect(screen.queryByText(/copy list/i)).toBeNull()
  })
})

describe('desktop list header controls (AWTD-1167, AWTD-1168)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const header3Col = (props: Record<string, unknown> = {}) =>
    render(<MainContent {...baseProps} columnCount={3} {...props} />)

  // AWTD-1356, Jon: "We are moving it to the header." The funnel used to hover
  // ON the divider line between the add-task box and the tasks, absolutely
  // positioned and aligned to the task checkbox (AWTD-1204), and below 3
  // columns it did not exist at all — List Settings carried the way in
  // (AWTD-1175). Both are gone: it is an ordinary header button beside the
  // gear, at every width, so there is no placement rule left to keep in step.
  it('sort & filters sits in the header beside the gear, not on the divider line', () => {
    const { container } = header3Col()

    const titleRow = container.querySelector('h1')!.closest('.flex.items-center')!
    const funnel = titleRow.querySelector('[data-sort-filters-button]')
    expect(funnel).not.toBeNull()
    expect(titleRow.querySelector('[data-settings-button]')).not.toBeNull()

    // The old placement is gone, not merely moved: nothing absolutely
    // positioned against the divider remains.
    expect(screen.queryByTestId('list-filter-row')).toBeNull()
    expect(funnel!.className).not.toContain('absolute')
    expect(funnel!.className).not.toContain('-bottom-4')
  })

  it('the funnel comes before the gear, so the gear stays the rightmost control', () => {
    const { container } = header3Col()
    const titleRow = container.querySelector('h1')!.closest('.flex.items-center')!
    const funnel = titleRow.querySelector('[data-sort-filters-button]')!
    const gear = titleRow.querySelector('[data-settings-button]')!
    expect(funnel.compareDocumentPosition(gear) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('the funnel opens this viewer’s Sort & Filters, not the shared list settings', () => {
    const setShowSettingsPopover = vi.fn()
    const setShowSortFiltersFor = vi.fn()
    header3Col({ setShowSettingsPopover, setShowSortFiltersFor })

    fireEvent.click(screen.getByRole('button', { name: /sort/i }))

    // The seam task aa4e7eb0 drew still holds: sort & filters is per-user, the
    // gear is the list as everyone sees it.
    expect(setShowSortFiltersFor).toHaveBeenCalledWith('list-1')
    expect(setShowSettingsPopover).not.toHaveBeenCalled()
  })

  it('a system list gets the same button, opening its fixed settings', () => {
    const setShowSettingsPopover = vi.fn()
    header3Col({ selectedListId: 'today', setShowSettingsPopover })

    fireEvent.click(screen.getByRole('button', { name: /sort/i }))

    // A system list has no shared settings to separate from, so its funnel IS
    // the way into its filter panel.
    expect(setShowSettingsPopover).toHaveBeenCalledWith('today')
  })

  it('the List / Board toggle shows icons only, at every width', () => {
    header3Col({ hasProjectBoard: true })
    const toggle = screen.getByTestId('header-list-board-toggle')
    for (const label of toggle.querySelectorAll('button span')) {
      expect(label.className).toBe('sr-only')
    }
    // Still named for screen readers.
    expect(screen.getByRole('button', { name: /board/i })).toBeInTheDocument()
  })

  it('the board view keeps the header: toggle back to the list, and sort & filters', () => {
    header3Col({ hasProjectBoard: true, taskViewMode: 'board' })
    expect(screen.getByTestId('header-list-board-toggle')).toBeVisible()
    expect(screen.getByRole('button', { name: /sort/i })).toBeVisible()
    // Columns have their own add, so the header's input is not shown there.
    expect(screen.queryByPlaceholderText(/add a task/i)).toBeNull()
  })
})
