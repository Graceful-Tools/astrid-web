import { ReactElement, ReactNode } from 'react'
import { SessionProvider } from 'next-auth/react'

interface TestSessionProviderProps {
  children: ReactNode
  session?: any
}

export const TestSessionProvider = ({ 
  children, 
  session = {
    user: {
      id: 'test-user-id',
      name: 'Test User',
      email: 'test@example.com',
      image: null
    },
    expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours from now
  }
}: TestSessionProviderProps) => {
  return (
    <SessionProvider session={session}>
      {children}
    </SessionProvider>
  )
}

// Custom render function that includes providers by default
import { render, RenderOptions } from '@testing-library/react'

interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  session?: any
}

export const renderWithProviders = (
  ui: ReactElement,
  { session, ...renderOptions }: CustomRenderOptions = {}
) => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <TestSessionProvider session={session}>
      {children}
    </TestSessionProvider>
  )

  return render(ui, { wrapper: Wrapper, ...renderOptions })
}

/*
 * Render harness for the components that used to be called "unrenderable"
 * (ADEV-296): MainContent, which wants a few dozen props from the task-manager
 * controller, and the TaskRow it mounts. Every handler is a spy, every state
 * value a quiet default, so a test passes only what it is about and asserts on
 * the DOM or on which spy fired.
 *
 * Module-level concerns (router, SSE, heavy children) are declared with vi.mock
 * in the test file that needs them, since vi.mock is hoisted per file.
 */
import { vi } from 'vitest'
import type { ComponentProps } from 'react'
import type { MainContent } from '@/components/TaskManager/MainContent/MainContent'
import type { Task, TaskList } from '@/types/task'

export type MainContentTestProps = ComponentProps<typeof MainContent>

export const makeTestTask = (overrides: Partial<Task> = {}): Task =>
  ({ id: 'task-1', title: 'Buy milk', completed: false, priority: 0, ...overrides }) as unknown as Task

export const makeTestList = (overrides: Partial<TaskList> = {}): TaskList =>
  ({ id: 'list-1', name: 'Groceries', ownerId: 'test-user-id', privacy: 'PRIVATE', ...overrides }) as unknown as TaskList

export function makeMainContentProps(overrides: Partial<MainContentTestProps> = {}): MainContentTestProps {
  const list = makeTestList()
  const task = makeTestTask()
  const noop = () => {}
  const asyncNoop = async () => {}
  return {
    isMobile: false,
    mobileView: 'list',
    columnCount: 3,
    selectedListId: list.id,
    lists: [list],
    allTasks: [task],
    finalFilteredTasks: [task],
    effectiveSession: { user: { id: 'test-user-id', name: 'Test User', email: 'test@example.com' } },
    availableUsers: [],
    newFilterState: {
      filters: {
        search: { trim: () => '' },
        priority: [], assignee: [], dueDate: 'all', completed: 'default', sortBy: 'auto',
      },
      setPriority: vi.fn(), setAssignee: vi.fn(), setDueDate: vi.fn(), setCompleted: vi.fn(), setSortBy: vi.fn(),
      hasActiveFilters: false,
      clearAllFilters: vi.fn(),
    },
    selectedTaskId: '',
    showSettingsPopover: null, setShowSettingsPopover: vi.fn(),
    showSortFiltersFor: null, setShowSortFiltersFor: vi.fn(),
    showLeaveListMenu: null, setShowLeaveListMenu: vi.fn(),
    editingListName: false, setEditingListName: vi.fn(),
    tempListName: '', setTempListName: vi.fn(),
    editingListDescription: false, setEditingListDescription: vi.fn(),
    tempListDescription: '', setTempListDescription: vi.fn(),
    quickTaskInput: '', setQuickTaskInput: vi.fn(),
    recentlyChangedList: false,
    isSessionReady: true,
    justReturnedFromTaskDetail: false,
    pullToRefresh: {
      isRefreshing: false, isPulling: false, canRefresh: false, pullDistance: 0,
      bindToElement: noop, onTouchStart: noop, onTouchMove: noop, onTouchEnd: noop,
    },
    handleListImageClick: vi.fn(),
    handleEditListName: vi.fn(),
    handleSaveListName: vi.fn(asyncNoop),
    handleEditListDescription: vi.fn(),
    handleSaveListDescription: vi.fn(asyncNoop),
    handleLeaveList: vi.fn(asyncNoop),
    handleQuickTaskKeyDown: vi.fn(),
    handleAddTaskButtonClick: vi.fn(),
    handleTaskClick: vi.fn(asyncNoop),
    handleUpdateTask: vi.fn(),
    handleToggleTaskComplete: vi.fn(asyncNoop),
    handleQuickCreateTask: vi.fn(async () => null),
    handleCreateNewTask: vi.fn(),
    handleCopyList: vi.fn(asyncNoop),
    handleCopyTask: vi.fn(asyncNoop),
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
    promoteTargetVisible: false,
    handleTaskDropOnPromoteTarget: vi.fn(asyncNoop),
    canEditListSettingsMemo: () => true,
    getSelectedListInfo: () => ({ name: list.name ?? '', description: '' }),
    taskManagerRef: { current: null },
    isKeyboardScrollingRef: { current: false },
    onListUpdate: vi.fn(asyncNoop),
    onListDelete: vi.fn(),
    ...overrides,
  } as MainContentTestProps
}