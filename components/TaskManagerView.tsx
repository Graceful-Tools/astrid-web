"use client"

import { SettingsSecondPane } from "./TaskManager/SettingsSecondPane"
import { SkipToContentLink } from "./TaskManager/SkipToContentLink"
import React, { memo } from "react"
import { taskDetailPaneProps } from "./TaskManager/task-detail-pane-props"
import { TaskManagerHeader } from "./TaskManager/Header/TaskManagerHeader"
import { LeftSidebar } from "./TaskManager/Sidebar/LeftSidebar"
import { DesktopChatPane } from "./TaskManager/DesktopChatPane"
import { DrawerTapGuard } from "./TaskManager/DrawerTapGuard"
import { DesktopSettingsDetailPane } from "./TaskManager/DesktopSettingsDetailPane"
import { MainContent } from "./TaskManager/MainContent/MainContent"
import { LoadingScreen } from "./loading-screen"
import { computeTaskPaneLeftOffset } from "./TaskManager/task-pane-position"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Copy } from "lucide-react"
import { useKeyboardShortcuts, type KeyboardShortcutHandlers } from "@/hooks/useKeyboardShortcuts"
import { AddTaskInput } from "./add-task-input"
import { ChatToggle } from "./chat/ChatToggle"
import {
  LazyAddListModal,
  LazyChatPanel,
  LazyCommandPaletteDialog,
  LazyKeyboardShortcutsMenu,
  LazyPublicListsBrowser,
  LazySettingsDetailPanel,
  LazySettingsPanel,
  LazyTaskDetail,
} from "./TaskManager/lazy-panels"
import { didEnterBoardMode } from "@/lib/board-mode-transition"
import type { Task, TaskList, User } from "@/types/task"
import type { LayoutType } from "@/lib/layout-detection"
import { isMobilePhoneDevice } from "@/lib/layout-detection"
import { bodyClearsFloatingHeader } from "@/lib/task-area-position-classes"
import { canUserEditTask, canUserManageList } from "@/lib/list-permissions"
import { isCollaborativePublicTask } from "@/lib/public-list-utils"
import { useSlideCloseAnimation } from "@/hooks/task-manager/useSlideCloseAnimation"
import { useTaskManagerLayoutRouter } from "@/hooks/task-manager/useTaskManagerLayoutRouter"
import type { useFilterState } from "@/hooks/useFilterState"
import type { TaskDisplayMode } from "@/lib/task-display-mode"
import type { TaskManagerControllerReturn } from "@/hooks/task-manager/controller-contract"

export interface TaskManagerViewModel {
  // Data from controller
  tasks: Task[]
  lists: TaskList[]
  publicTasks: Task[]
  publicLists: TaskList[]
  collaborativePublicLists: TaskList[]
  suggestedPublicLists: TaskList[]
  loading: boolean
  selectedTaskId: string
  selectedListId: string
  /** The selected list is on a project board — computed by TaskManager (AWTD-1426). */
  hasProjectBoard: boolean
  selectedTask: Task | null
  finalFilteredTasks: Task[]
  availableUsers: User[]
  isSessionReady: boolean
  effectiveSession: TaskManagerControllerReturn['effectiveSession']
  newFilterState: ReturnType<typeof useFilterState>
  isViewingFromFeatured: boolean

  // Unified navigation
  activeView: 'list' | 'settings' | 'search'
  settingsPage: string | null
  isSettingsActive: boolean
  settingsSubPage: string | null
  isSearchActive: boolean
  onNavigateSettings: (page: string) => void
  onExitSettings: () => void
  onCloseSettingsSubPage: () => void
  onSelectSearch: () => void
  onExitSearch: () => void

  // Task panel animation state
  isTaskPaneClosing: boolean
  taskPanePosition: { left: number }
  setTaskPanePosition: (position: { left: number }) => void

  // Task element for arrow positioning
  selectedTaskElement?: HTMLElement | null

  // Count functions
  getTaskCountForListMemo: (listId: string) => number
  getSavedFilterTaskCountMemo: (list: TaskList) => number
  getFixedListTaskCountMemo: (listType: string) => number
  getSelectedListInfo: () => { name: string; description: string }

  // Permission functions
  canEditListSettingsMemo: (list: TaskList) => boolean

  // Utility functions

  // Refs
  isKeyboardScrollingRef: React.MutableRefObject<boolean>
  sidebarRef: React.MutableRefObject<HTMLDivElement | null>
  taskManagerRef: React.MutableRefObject<HTMLDivElement | null>

  // Data from layout manager
  layoutType: LayoutType
  columnCount: 1 | 2 | 3
  is1Column: boolean
  is2Column: boolean
  is3Column: boolean
  isMobile: boolean
  mobileView: 'list' | 'task' | 'chat'
  showHamburgerMenu: boolean
  showMobileSidebar: boolean
  mobileSearchMode: boolean
  justReturnedFromTaskDetail: boolean
  isMobileTaskDetailClosing: boolean
  isMobileTaskDetailOpen: boolean
  taskDetailDragOffset: number

  // Layout handlers
  toggleMobileSidebar: () => void
  handleMobileBack: () => void
  handleMobileSearchStart: () => void
  handleMobileSearchEnd: () => void
  handleMobileSearchClear: () => void
  handleMobileSearchKeyDown: (e: React.KeyboardEvent) => void
  swipeHandlers: {
    onTouchStart: (e: React.TouchEvent) => void
    onTouchMove: (e: React.TouchEvent) => void
    onTouchEnd: (e: React.TouchEvent) => void
  }
  sidebarSwipeToDismiss: {
    onTouchStart: (e: React.TouchEvent) => void
    onTouchMove: (e: React.TouchEvent) => void
    onTouchEnd: () => void
  }
  taskDetailSwipeToDismiss: {
    onTouchStart: (e: React.TouchEvent) => void
    onTouchMove: (e: React.TouchEvent) => void
    onTouchEnd: (e: React.TouchEvent) => void
  }
  pullToRefresh: {
    isRefreshing: boolean
    isPulling: boolean
    canRefresh: boolean
    pullDistance: number
    bindToElement: (element: HTMLElement | null) => void
    onTouchStart: (e: React.TouchEvent) => void
    onTouchMove: (e: React.TouchEvent) => void
    onTouchEnd: (e: React.TouchEvent) => void
  }

  // Data from modal manager
  showAddListModal: boolean
  showPublicBrowser: boolean
  quickTaskInput: string
  searchValue: string
  editingListName: boolean
  tempListName: string
  editingListDescription: boolean
  tempListDescription: string
  showSettingsPopover: string | null
  showSortFiltersFor: string | null
  showLeaveListMenu: string | null

  // State setters
  setQuickTaskInput: (value: string) => void
  setSearchValue: (value: string) => void
  setShowAddListModal: (value: boolean) => void
  setSelectedListId: (listId: string) => void
  setLists: (value: React.SetStateAction<TaskList[]>) => void
  setEditingListName: (value: boolean) => void
  setTempListName: (value: string) => void
  setEditingListDescription: (value: boolean) => void
  setTempListDescription: (value: string) => void
  setShowSettingsPopover: (value: string | null) => void
  setShowSortFiltersFor: (value: string | null) => void
  setShowLeaveListMenu: (value: string | null) => void
  setShowMobileSidebar: (value: boolean) => void

  // Business logic methods
  loadData: () => Promise<void>
  handleTaskClick: (taskId: string, taskElement?: HTMLElement) => void
  handleUpdateTask: (task: Task) => void
  /** Viewer's task display mode: 'list' | 'project' (task ffa5bbb5). */
  taskDisplayMode: TaskDisplayMode
  handleLocalUpdateTask: (task: Task) => void
  handleToggleTaskComplete: (taskId: string) => Promise<void>
  handleDeleteTask: (taskId: string) => void
  closeTaskDetail: () => void
  handleCreateTask: (
    taskTitle: string,
    options?: { priority?: number; assigneeId?: string | null; navigateToDetail?: boolean; listIds?: string[]; statusRole?: string; parentTaskId?: string | null },
  ) => Promise<string | null>
  handleQuickCreateTask: (title: string, options?: { priority?: number; assigneeId?: string | null; navigateToDetail?: boolean; listIds?: string[] }) => Promise<string | null>
  handleCreateNewTask: () => void
  handleCreateList: (listData: { name: string; description: string; memberEmails: string[] }) => Promise<void>
  handleCopyList: (listId: string) => Promise<void>
  handleCopyTask: (taskId: string, targetListId?: string, includeComments?: boolean) => Promise<void>
  handleDeleteList: (listId: string) => Promise<void>
  handleUpdateList: (updatedList: TaskList) => Promise<void>
  handleToggleListFavorite: (listId: string) => void
  handleLeaveList: (list: TaskList, isOwnerLeaving?: boolean) => Promise<void>

  // Drag and drop
  handleTaskDragStart: (taskId: string) => void
  handleTaskDragHover: (taskId: string, position: 'above' | 'below') => void
  handleTaskDragLeaveTask: (taskId: string) => void
  handleTaskDragHoverEnd: () => void
  handleTaskDragEnd: () => void
  handleTaskDropOnList: (listId: string, options: { shiftKey: boolean }) => void
  handleListDragEnter: (listId: string, shiftKey: boolean) => void
  handleListDragLeave: (listId: string) => void
  handleListDragOver: (listId: string, shiftKey: boolean) => void
  activeDragTaskId: string | null
  dragOverListId: string | null
  isShiftDrag: boolean
  dragTargetTaskId: string | null
  dragTargetPosition: 'above' | 'below' | 'end' | null
  manualSortActive: boolean
  manualSortPreviewActive: boolean
  promoteTargetVisible: boolean
  handleTaskDropOnPromoteTarget: () => Promise<void>

  // Mobile quick task handlers
  handleQuickTaskKeyDown: (e: React.KeyboardEvent) => void
  handleAddTaskButtonClick: () => void

  // List image handler
  handleListImageClick: (listId: string) => void

  // Keyboard shortcut handlers
  handleSelectNextTask: () => void
  handleSelectPreviousTask: () => void
  handleToggleTaskPanel: () => void
  handleCycleListFilters: () => void
  handleJumpToDate: () => void
  handleNewTask: () => void
  handleCompleteTask: () => void
  handlePostponeTask: () => void
  handleRemoveDueDate: () => void
  handleSetPriority: (priority: 0 | 1 | 2 | 3) => void
  handleMakeDueDateEarlier: () => void
  handleMakeDueDateLater: () => void
  handleEditTaskLists: () => void
  handleEditTaskTitle: () => void
  handleEditTaskDescription: () => void
  handleAddTaskComment: () => void
  handleAssignToNoOne: () => void
  handleOutdentTask: () => void
  handleIndentTask: () => void
  handleShowHotkeyMenu: () => void
  handleShowCommandPalette: () => void

  // Hotkey menu state
  showHotkeyMenu: boolean
  setShowHotkeyMenu: (show: boolean) => void

  // Command palette state
  showCommandPalette: boolean
  setShowCommandPalette: (show: boolean) => void
  handleExecuteCommand: (command: any) => void

  // Public browser handlers
  handleListCopied: (copiedList: any) => Promise<void>
  setShowPublicBrowser: (show: boolean) => void

  // Chat
  activePanel: 'tasks' | 'chat'
  setActivePanel: (panel: 'tasks' | 'chat') => void
  chatChannelId: string | null
  chatChannelLoading?: boolean
  chatListMembers: User[]
  chatListId?: string | null

  // Layout coordination
  setLayoutBoardMode?: (boardMode: boolean) => void
}

/**
 * TaskManagerView - Pure presentation component
 *
 * This component is responsible ONLY for rendering the UI.
 * It receives all data and handlers as props, making it:
 * - Completely testable
 * - React Native compatible (can swap out UI components)
 * - Framework agnostic
 * - Easy to reason about
 */
const TaskManagerView = memo(function TaskManagerView({
  tasks,
  lists,
  publicLists,
  collaborativePublicLists,
  suggestedPublicLists,
  loading,
  selectedTaskId,
  selectedListId,
  selectedTask,
  finalFilteredTasks,
  availableUsers,
  isViewingFromFeatured,
  activeView,
  settingsPage,
  isSettingsActive,
  settingsSubPage,
  isSearchActive,
  onNavigateSettings,
  onExitSettings,
  onCloseSettingsSubPage,
  onSelectSearch,
  onExitSearch,
  getTaskCountForListMemo,
  getSavedFilterTaskCountMemo,
  getFixedListTaskCountMemo,
  getSelectedListInfo,
  canEditListSettingsMemo,
  isKeyboardScrollingRef,
  sidebarRef,
  taskManagerRef,
  layoutType,
  columnCount,
  is1Column,
  is2Column,
  is3Column,
  isMobile,
  mobileView,
  showHamburgerMenu,
  showMobileSidebar,
  mobileSearchMode,
  justReturnedFromTaskDetail,
  isMobileTaskDetailClosing,
  isMobileTaskDetailOpen,
  taskDetailDragOffset,
  toggleMobileSidebar,
  handleMobileBack,
  handleMobileSearchStart,
  handleMobileSearchEnd,
  handleMobileSearchClear,
  handleMobileSearchKeyDown,
  swipeHandlers,
  sidebarSwipeToDismiss,
  taskDetailSwipeToDismiss,
  pullToRefresh,
  showAddListModal,
  showPublicBrowser,
  quickTaskInput,
  searchValue,
  editingListName,
  tempListName,
  editingListDescription,
  tempListDescription,
  showSettingsPopover,
  showSortFiltersFor,
  showLeaveListMenu,
  setQuickTaskInput,
  setSearchValue,
  setShowAddListModal,
  setSelectedListId,
  setLists,
  setEditingListName,
  setTempListName,
  setEditingListDescription,
  setTempListDescription,
  setShowSettingsPopover,
  setShowSortFiltersFor,
  setShowLeaveListMenu,
  setShowMobileSidebar,
  loadData,
  handleTaskClick,
  handleUpdateTask,
  taskDisplayMode,
  handleLocalUpdateTask,
  handleToggleTaskComplete,
  handleDeleteTask,
  closeTaskDetail,
  handleCreateTask,
  handleQuickCreateTask,
  handleCreateNewTask,
  handleCreateList,
  handleCopyList,
  handleCopyTask,
  handleDeleteList,
  handleUpdateList,
  handleToggleListFavorite,
  handleLeaveList,
  handleTaskDragStart,
  handleTaskDragHover,
  handleTaskDragLeaveTask,
  handleTaskDragHoverEnd,
  handleTaskDragEnd,
  handleTaskDropOnList,
  handleListDragEnter,
  handleListDragLeave,
  handleListDragOver,
  activeDragTaskId,
  dragOverListId,
  isShiftDrag,
  dragTargetTaskId,
  dragTargetPosition,
  manualSortActive,
  manualSortPreviewActive,
  promoteTargetVisible,
  handleTaskDropOnPromoteTarget,
  effectiveSession,
  isSessionReady,
  newFilterState,
  isTaskPaneClosing,
  taskPanePosition,
  setTaskPanePosition,
  selectedTaskElement,
  handleQuickTaskKeyDown,
  handleAddTaskButtonClick,
  handleListImageClick,
  handleSelectNextTask,
  handleSelectPreviousTask,
  handleToggleTaskPanel,
  handleCycleListFilters,
  handleJumpToDate,
  handleNewTask,
  handleCompleteTask,
  handlePostponeTask,
  handleRemoveDueDate,
  handleSetPriority,
  handleMakeDueDateEarlier,
  handleMakeDueDateLater,
  handleEditTaskLists,
  handleEditTaskTitle,
  handleEditTaskDescription,
  handleAddTaskComment,
  handleAssignToNoOne,
  handleOutdentTask,
  handleIndentTask,
  handleShowHotkeyMenu,
  handleShowCommandPalette,
  showHotkeyMenu,
  setShowHotkeyMenu,
  showCommandPalette,
  setShowCommandPalette,
  handleExecuteCommand,
  handleListCopied,
  setShowPublicBrowser,
  activePanel,
  setActivePanel,
  chatChannelId,
  chatChannelLoading,
  chatListMembers,
  chatListId,
  setLayoutBoardMode,
  hasProjectBoard,
}: TaskManagerViewModel) {
  const [taskViewMode, setTaskViewMode] = React.useState<'list' | 'board'>('list')
  const isBoardMode = hasProjectBoard && taskViewMode === 'board'

  const handleProjectBoardCreated = React.useCallback((projectLists: TaskList[]) => {
    setLists(prevLists => {
      const byId = new Map(prevLists.map(list => [list.id, list]))
      projectLists.forEach(list => byId.set(list.id, list))
      return Array.from(byId.values())
    })
  }, [setLists])

  const handleProjectBoardRemoved = React.useCallback((projectId: string, detachedListIds: string[]) => {
    const detachedSet = new Set(detachedListIds)
    setLists(prevLists =>
      prevLists
        .filter(list => !(list.projectId === projectId && list.listType === 'status'))
        .map(list =>
          list.projectId === projectId || detachedSet.has(list.id)
            ? { ...list, projectId: null }
            : list
        )
    )
    setTaskViewMode('list')
  }, [setLists])

  React.useEffect(() => {
    if (!hasProjectBoard && taskViewMode === 'board') {
      setTaskViewMode('list')
    }
  }, [hasProjectBoard, taskViewMode])

  // Tell the layout hook whether the board carousel owns horizontal gestures,
  // so the body-level swipe handler doesn't steal them and change the header.
  React.useEffect(() => {
    setLayoutBoardMode?.(isBoardMode)
    return () => setLayoutBoardMode?.(false)
  }, [isBoardMode, setLayoutBoardMode])

  // Only fire the "leave chat / close task detail" side-effects at the
  // moment of entering board mode, NOT every render while in it — otherwise
  // any state change in board view (e.g. tapping Messages to flip
  // activePanel='chat') gets immediately reverted. See bug a1e5c0ff
  // follow-up and lib/board-mode-transition.ts.
  const prevTaskViewModeRef = React.useRef<'list' | 'board'>(taskViewMode)
  React.useEffect(() => {
    const prev = prevTaskViewModeRef.current
    prevTaskViewModeRef.current = taskViewMode
    if (didEnterBoardMode({ prevTaskViewMode: prev, nextTaskViewMode: taskViewMode })) {
      setActivePanel('tasks')
      closeTaskDetail()
    }
  }, [closeTaskDetail, setActivePanel, taskViewMode])

  const autoOpenedSidebarRef = React.useRef(false)

  const settingsCloseAnimation = useSlideCloseAnimation({
    bypassAnimation: is1Column,
    duration: 300,
  })
  const isSettingsPaneClosing = settingsCloseAnimation.isClosing

  const closeSettingsSubPageAnimated = React.useCallback(() => {
    settingsCloseAnimation.runAnimatedClose(onCloseSettingsSubPage)
  }, [settingsCloseAnimation, onCloseSettingsSubPage])

  const navigateSettingsWithAnimation = React.useCallback((page: string) => {
    if (page === settingsSubPage) {
      closeSettingsSubPageAnimated()
      return
    }
    if (settingsSubPage && page !== 'hub') {
      settingsCloseAnimation.runAnimatedClose(() => onNavigateSettings(page), 200)
      return
    }
    onNavigateSettings(page)
  }, [settingsSubPage, closeSettingsSubPageAnimated, onNavigateSettings, settingsCloseAnimation])

  const dismissActiveOverlay = React.useCallback(() => {
    if (selectedTask) {
      closeTaskDetail()
    } else if (settingsSubPage) {
      closeSettingsSubPageAnimated()
    }
  }, [selectedTask, settingsSubPage, closeTaskDetail, closeSettingsSubPageAnimated])

  const handleHamburgerDragHover = React.useCallback(() => {
    if (!activeDragTaskId || showMobileSidebar) {
      return
    }
    setShowMobileSidebar(true)
    autoOpenedSidebarRef.current = true
  }, [activeDragTaskId, showMobileSidebar, setShowMobileSidebar])

  const handleTaskDragStartInternal = React.useCallback((taskId: string) => {
    autoOpenedSidebarRef.current = false
    handleTaskDragStart(taskId)
  }, [handleTaskDragStart])

  const handleTaskDragEndInternal = React.useCallback(() => {
    handleTaskDragEnd()
    if (autoOpenedSidebarRef.current && showMobileSidebar) {
      setShowMobileSidebar(false)
    }
    autoOpenedSidebarRef.current = false
  }, [handleTaskDragEnd, showMobileSidebar, setShowMobileSidebar])

  // Refs for calculating task panel position
  // Refs are now passed as props from parent component
  // (removed local ref creation to use refs from useTaskManagerLayout)

  // Calculate task pane position based on layout type and component widths
  React.useEffect(() => {
    const calculatePosition = () => {
      if (sidebarRef.current && taskManagerRef.current && (selectedTaskId || settingsSubPage) && !is1Column) {
        const sidebarRect = sidebarRef.current.getBoundingClientRect()
        const taskManagerRect = taskManagerRef.current.getBoundingClientRect()

        // Layout-aware positioning (pure math in task-pane-position). The window
        // width keeps the panel on screen when messages is hidden (AWTD-1205).
        const leftOffset = computeTaskPaneLeftOffset(sidebarRect.width, taskManagerRect.width,
          { is2Column, is3Column, showHamburgerMenu }, window.innerWidth)

        // Update the task pane position
        setTaskPanePosition({ left: leftOffset })
      }
    }

    calculatePosition()
    window.addEventListener('resize', calculatePosition)

    return () => {
      window.removeEventListener('resize', calculatePosition)
    }
  }, [selectedTaskId, settingsSubPage, is1Column, is2Column, is3Column, showHamburgerMenu, setTaskPanePosition, sidebarRef, taskManagerRef])

  // Keyboard shortcuts setup
  const keyboardShortcutHandlers: KeyboardShortcutHandlers = {
    onSelectNextTask: handleSelectNextTask,
    onSelectPreviousTask: handleSelectPreviousTask,
    onToggleTaskPanel: handleToggleTaskPanel,
    onCycleListFilters: handleCycleListFilters,
    onJumpToDate: handleJumpToDate,
    onNewTask: handleNewTask,
    onCompleteTask: handleCompleteTask,
    onDeleteTask: () => selectedTaskId && handleDeleteTask(selectedTaskId),
    onPostponeTask: handlePostponeTask,
    onRemoveDueDate: handleRemoveDueDate,
    onSetPriority: handleSetPriority,
    onMakeDueDateEarlier: handleMakeDueDateEarlier,
    onMakeDueDateLater: handleMakeDueDateLater,
    onEditTaskLists: handleEditTaskLists,
    onEditTaskTitle: handleEditTaskTitle,
    onEditTaskDescription: handleEditTaskDescription,
    onAddTaskComment: handleAddTaskComment,
    onAssignToNoOne: handleAssignToNoOne,
    onOutdentTask: handleOutdentTask,
    onIndentTask: handleIndentTask,
    onShowHotkeyMenu: handleShowHotkeyMenu,
    onShowCommandPalette: handleShowCommandPalette,
  }

  const keyboardShortcuts = useKeyboardShortcuts({
    handlers: keyboardShortcutHandlers,
    selectedTask,
    isEnabled: true,
    isInputFocused: false // TODO: Detect when inputs are focused
  })

  // Outside click detection for desktop task pane
  React.useEffect(() => {
    if (!selectedTask || is1Column) return // No outside click needed for mobile or when no task selected

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element
      if (!target) return

      // Don't close if clicking inside the task panel
      if (target.closest('.task-panel-desktop')) return

      // Don't close if clicking on a task item (this would prevent opening new tasks)
      if (target.closest('[data-task-id]')) return

      // Don't close if clicking on modal/popover content
      if (target.closest('.modal, .popover, [role="dialog"], [role="menu"]')) return

      // Don't close if clicking on dropdown menus or date pickers
      if (target.closest('.dropdown, .calendar, .date-picker')) return

      // Don't close if clicking inside the app header (settings, search, etc.)
      if (target.closest('.app-header')) return

      // Don't close if clicking on settings/filter button
      if (target.closest('[data-settings-button]')) return

      // Don't close if clicking on task detail content (e.g., Select dropdowns)
      if (target.closest('[data-task-detail-content="true"]')) return

      // Don't close if clicking on Radix UI portaled content (Select, Popover, etc.)
      if (target.closest('[data-radix-popper-content-wrapper]')) return
      if (target.closest('[data-radix-select-content]')) return

      // Close the task panel
      closeTaskDetail()
    }

    // Add event listener with capture to ensure we catch it before other handlers
    document.addEventListener('mousedown', handleClickOutside, true)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true)
    }
  }, [selectedTask, is1Column, closeTaskDetail])

  // Local list editing handlers
  const handleEditListName = (list: TaskList) => {
    setTempListName(list.name)
    setEditingListName(true)
  }

  const handleSaveListName = async () => {
    try {
      if (!tempListName.trim()) return

      const currentList = lists.find(list => list.id === selectedListId)
      if (!currentList) return

      const updatedList = { ...currentList, name: tempListName.trim() }
      await handleUpdateList(updatedList)
      setEditingListName(false)
      setTempListName('')
    } catch (error) {
      console.error('Error updating list name:', error)
    }
  }

  const handleEditListDescription = (list: TaskList) => {
    setTempListDescription(list.description || '')
    setEditingListDescription(true)
  }

  const handleSaveListDescription = async () => {
    try {
      const currentList = lists.find(list => list.id === selectedListId)
      if (!currentList) return

      const updatedList = { ...currentList, description: tempListDescription }
      await handleUpdateList(updatedList)
      setEditingListDescription(false)
      setTempListDescription('')
    } catch (error) {
      console.error('Error updating list description:', error)
    }
  }

  // Resolve the full render matrix (which surface + which panes) up front.
  // Hooks must run before the early return below.
  const layout = useTaskManagerLayoutRouter({
    isMobile,
    isBoardMode,
    is1Column,
    is2Column,
    is3Column,
    isSettingsActive,
    isSettingsPaneClosing,
    settingsSubPage,
    isSearchActive,
    activePanel,
    mobileView,
    taskViewMode,
    showHamburgerMenu,
    hasUser: Boolean(effectiveSession?.user),
    hasSelectedTask: Boolean(selectedTask),
    isTaskPaneClosing,
    isMobileTaskDetailClosing,
  })

  // Show loading screen if no session (on all devices)
  if (!effectiveSession?.user) {
    return <LoadingScreen />
  }

  // iOS drawer: sidebar is always rendered, content slides to reveal it
  // Works on mobile AND 2-column view (anywhere hamburger menu is shown)
  const isIOSDrawer = layout.isIOSDrawer

  return (
    <div className="app-container theme-bg-primary theme-text-primary">
      {/* Skip link: first Tab stop, visible only while focused (AWTD-1435) */}
      <SkipToContentLink />
      {/* Mobile Sidebar - rendered outside content wrapper for iOS drawer effect */}
      {isIOSDrawer && (
        <LeftSidebar
          isMobile={isMobile}
          showHamburgerMenu={isIOSDrawer}
          showMobileSidebar={showMobileSidebar}
          sidebarRef={sidebarRef}
          effectiveSession={effectiveSession}
          lists={lists}
          publicLists={publicLists}
          collaborativePublicLists={collaborativePublicLists}
          suggestedPublicLists={suggestedPublicLists}
          selectedListId={selectedListId}
          getFixedListTaskCountMemo={getFixedListTaskCountMemo}
          getSavedFilterTaskCountMemo={getSavedFilterTaskCountMemo}
          getTaskCountForListMemo={getTaskCountForListMemo}
          setSelectedListId={setSelectedListId}
          setShowMobileSidebar={setShowMobileSidebar}
          setShowAddListModal={setShowAddListModal}
          setShowPublicBrowser={setShowPublicBrowser}
          setShowSettingsPopover={setShowSettingsPopover}
          onNavigateSettings={onNavigateSettings}
          onLogoClick={loadData}
          activeView={activeView}
          onSelectSearch={onSelectSearch}
          sidebarSwipeToDismiss={sidebarSwipeToDismiss}
          isTaskDragActive={Boolean(activeDragTaskId)}
          dragOverListId={dragOverListId}
          isShiftDrag={isShiftDrag}
          onTaskDropOnList={handleTaskDropOnList}
          onTaskDragEnter={handleListDragEnter}
          onTaskDragLeave={handleListDragLeave}
          onTaskDragOver={(shiftKey, listId) => handleListDragOver(listId, shiftKey)}
        />
      )}

      {/* iOS Drawer Content Wrapper - slides right to reveal sidebar */}
      <div className={`flex flex-col h-full scrollbar-hide ${isIOSDrawer ? `ios-drawer-content ${showMobileSidebar ? 'ios-drawer-content-open' : ''}` : ''}`}>
        {/* Header */}
        <TaskManagerHeader
          isMobile={isMobile}
          showHamburgerMenu={isIOSDrawer}
          mobileView={mobileView}
          isMobileTaskDetailClosing={isMobileTaskDetailClosing}
          lists={lists}
          selectedListId={selectedListId}
          selectedTask={selectedTask}
          effectiveSession={effectiveSession}
          mobileSearchMode={mobileSearchMode}
          searchValue={searchValue}
          myTasksFilterPriority={selectedListId === 'my-tasks' ? newFilterState.filters.priority : undefined}
          myTasksFilterDueDate={selectedListId === 'my-tasks' ? newFilterState.filters.dueDate : undefined}
          toggleMobileSidebar={toggleMobileSidebar}
          handleMobileBack={handleMobileBack}
          onLogoClick={loadData}
          handleMobileSearchStart={handleMobileSearchStart}
          handleMobileSearchEnd={handleMobileSearchEnd}
          handleMobileSearchClear={handleMobileSearchClear}
          handleMobileSearchKeyDown={handleMobileSearchKeyDown}
          onSearchChange={setSearchValue}
          setShowSettingsPopover={setShowSettingsPopover}
          setShowSortFiltersFor={setShowSortFiltersFor}
          onShowKeyboardShortcuts={handleShowHotkeyMenu}
          isTaskDragActive={Boolean(activeDragTaskId)}
          onHamburgerDragHover={handleHamburgerDragHover}
          activePanel={activePanel}
          onToggleActivePanel={isMobile ? setActivePanel : undefined}
          hasProjectBoard={hasProjectBoard}
          taskViewMode={taskViewMode}
          onTaskViewModeChange={setTaskViewMode}
          activeView={activeView}
          settingsPage={settingsPage}
          isSearchActive={isSearchActive}
          onExitSettings={onExitSettings}
          onNavigateSettings={onNavigateSettings}
          onExitSearch={onExitSearch}
        />

        {/* Main Layout */}
        <div className={`flex flex-1 min-h-0 app-body ${bodyClearsFloatingHeader({ isMobile, isIOSDrawer }) ? 'app-body-with-floating-header' : ''}`} {...swipeHandlers}>
          {/* Left Sidebar - only in non-iOS-drawer mode (desktop) */}
          {!isIOSDrawer && (
            <LeftSidebar
              isMobile={isMobile}
              showHamburgerMenu={showHamburgerMenu}
              showMobileSidebar={showMobileSidebar}
              sidebarRef={sidebarRef}
              effectiveSession={effectiveSession}
              lists={lists}
              publicLists={publicLists}
              collaborativePublicLists={collaborativePublicLists}
              suggestedPublicLists={suggestedPublicLists}
              selectedListId={selectedListId}
              getFixedListTaskCountMemo={getFixedListTaskCountMemo}
              getSavedFilterTaskCountMemo={getSavedFilterTaskCountMemo}
              getTaskCountForListMemo={getTaskCountForListMemo}
              setSelectedListId={setSelectedListId}
              setShowMobileSidebar={setShowMobileSidebar}
              setShowAddListModal={setShowAddListModal}
              setShowPublicBrowser={setShowPublicBrowser}
              setShowSettingsPopover={setShowSettingsPopover}
              onNavigateSettings={onNavigateSettings}
              onLogoClick={loadData}
              activeView={activeView}
              onSelectSearch={onSelectSearch}
              sidebarSwipeToDismiss={sidebarSwipeToDismiss}
              isTaskDragActive={Boolean(activeDragTaskId)}
              dragOverListId={dragOverListId}
              isShiftDrag={isShiftDrag}
              onTaskDropOnList={handleTaskDropOnList}
              onTaskDragEnter={handleListDragEnter}
              onTaskDragLeave={handleListDragLeave}
              onTaskDragOver={(shiftKey, listId) => handleListDragOver(listId, shiftKey)}
            />
          )}

        <main id="main-content" className="contents" /* out of the flex layout (AWTD-1435) */>
        {layout.mainSurface === 'settings' ? (
          <div className="flex-1 min-h-0 overflow-hidden flex">
            <div className="flex-1 min-w-0 overflow-y-auto scrollbar-hide" ref={taskManagerRef}>
              <LazySettingsPanel onNavigate={navigateSettingsWithAnimation} onExit={onExitSettings} />
            </div>

            {layout.showSettingsSecondPane && <SettingsSecondPane />}
          </div>
        ) : layout.mainSurface === 'mobileChat' ? (
          // On mobile, messages replace the task surface.
          <div className="flex-1 min-h-0" ref={taskManagerRef}>
            <LazyChatPanel
              channelId={chatChannelId}
              currentUser={effectiveSession?.user}
              listMembers={chatListMembers}
              lists={lists}
              tasks={finalFilteredTasks}
              selectedListId={selectedListId}
              listId={chatListId}
              isLoading={chatChannelLoading}
              className="h-full"
            />
          </div>
        ) : (
          <MainContent
            isMobile={isMobile}
            mobileView={mobileView}
            isMobileTaskDetailClosing={isMobileTaskDetailClosing}
            columnCount={columnCount}
            selectedListId={selectedListId}
            lists={lists}
            allTasks={tasks}
            finalFilteredTasks={finalFilteredTasks}
            listMetadata={publicLists.find(list => list.id === selectedListId) ?? {}}
            effectiveSession={effectiveSession}
            availableUsers={availableUsers}
            newFilterState={newFilterState}
            isSearchActive={isSearchActive}
            searchValue={searchValue}
            onSearchChange={setSearchValue}
            selectedTaskId={selectedTaskId}
            isViewingFromFeatured={isViewingFromFeatured}
            showSettingsPopover={showSettingsPopover}
            showSortFiltersFor={showSortFiltersFor}
            setShowSortFiltersFor={setShowSortFiltersFor}
            setShowSettingsPopover={setShowSettingsPopover}
            showLeaveListMenu={showLeaveListMenu}
            setShowLeaveListMenu={setShowLeaveListMenu}
            editingListName={editingListName}
            setEditingListName={setEditingListName}
            tempListName={tempListName}
            setTempListName={setTempListName}
            editingListDescription={editingListDescription}
            setEditingListDescription={setEditingListDescription}
            tempListDescription={tempListDescription}
            setTempListDescription={setTempListDescription}
            quickTaskInput={quickTaskInput}
            setQuickTaskInput={setQuickTaskInput}
            recentlyChangedList={false}
            isSessionReady={isSessionReady}
            justReturnedFromTaskDetail={justReturnedFromTaskDetail}
            hasProjectBoard={hasProjectBoard}
            taskViewMode={taskViewMode}
            onTaskViewModeChange={setTaskViewMode}
            pullToRefresh={pullToRefresh}
            handleListImageClick={handleListImageClick}
            handleEditListName={handleEditListName}
            handleSaveListName={handleSaveListName}
            handleEditListDescription={handleEditListDescription}
            handleSaveListDescription={handleSaveListDescription}
            handleLeaveList={handleLeaveList}
            handleQuickTaskKeyDown={handleQuickTaskKeyDown}
            handleAddTaskButtonClick={handleAddTaskButtonClick}
            handleTaskClick={async (taskId: string, taskElement?: HTMLElement) => handleTaskClick(taskId, taskElement)}
            handleUpdateTask={handleUpdateTask}
            taskDisplayMode={taskDisplayMode}
            handleLocalUpdateTask={handleLocalUpdateTask as ((updatedTaskOrFn: Task | ((taskId: string, currentTask: Task) => Task)) => void)}
            handleToggleTaskComplete={handleToggleTaskComplete}
            handleDeleteTask={handleDeleteTask}
            handleQuickCreateTask={handleQuickCreateTask}
            handleCreateNewTask={handleCreateNewTask}
            handleTaskDragStart={handleTaskDragStartInternal}
            handleTaskDragHover={handleTaskDragHover}
            handleTaskDragLeaveTask={handleTaskDragLeaveTask}
            handleTaskDragHoverEnd={handleTaskDragHoverEnd}
            handleTaskDragEnd={handleTaskDragEndInternal}
            activeDragTaskId={activeDragTaskId}
            dragTargetTaskId={dragTargetTaskId}
            dragTargetPosition={dragTargetPosition}
            manualSortActive={manualSortActive}
            manualSortPreviewActive={manualSortPreviewActive}
            promoteTargetVisible={promoteTargetVisible}
            handleTaskDropOnPromoteTarget={handleTaskDropOnPromoteTarget}
            closeTaskDetail={closeTaskDetail}
            canEditListSettingsMemo={canEditListSettingsMemo}
            getSelectedListInfo={getSelectedListInfo}
            taskManagerRef={taskManagerRef}
            isKeyboardScrollingRef={isKeyboardScrollingRef}
            onListUpdate={handleUpdateList}
            onProjectBoardCreated={handleProjectBoardCreated}
            onProjectBoardRemoved={handleProjectBoardRemoved}
            onStatusesChanged={loadData}
            onFavoriteToggle={handleToggleListFavorite}
            onListDelete={handleDeleteList}
            handleCopyList={handleCopyList}
            handleCopyTask={handleCopyTask}
          />
        )}
        </main>

        {/* Chat Panel - inline flex column on the right (2-column and 3-column), hidden in settings, dimmed when task detail is open */}
        {layout.showDesktopChatPanel && effectiveSession?.user && (
          <DesktopChatPane boardMode={isBoardMode} dimmed={Boolean(selectedTask || settingsSubPage)} onDismissOverlay={dismissActiveOverlay}>
            <LazyChatPanel
              channelId={chatChannelId}
              currentUser={effectiveSession.user}
              listMembers={chatListMembers}
              lists={lists}
              tasks={finalFilteredTasks}
              selectedListId={selectedListId}
              listId={chatListId}
              isLoading={chatChannelLoading}
              className="h-full"
            />
          </DesktopChatPane>
        )}
        </div>
      </div>

      {/* iOS Drawer Overlay - tap to close sidebar. Mounted whether or not the
          drawer is open, so opening it is a transition rather than a first paint
          at full strength (AWTD-1379). */}
      {isIOSDrawer && (
        <DrawerTapGuard open={showMobileSidebar} onDismiss={() => setShowMobileSidebar(false)} />
      )}

      <DesktopSettingsDetailPane
        shown={layout.showDesktopSettingsDetailPane}
        page={settingsSubPage}
        closing={isSettingsPaneClosing}
        taskPaneLeft={taskPanePosition.left}
        onNavigate={onNavigateSettings}
        onClose={closeSettingsSubPageAnimated}
      />

      {/* Desktop Task Pane - positioned absolutely, slide-out from right.
          Kept mounted during close animation even when settings activates,
          so the slide-out can play instead of popping. */}
      {layout.showDesktopTaskPane && selectedTask && effectiveSession?.user && (() => {
        // Determine if user can edit this specific task based on list permissions and task creator
        const taskList = selectedTask.lists?.[0] || lists.find(l => l.id === selectedListId)
        const canEdit = taskList ? canUserEditTask(effectiveSession.user, selectedTask, taskList) : true

        return (
          <div
            className={`task-panel-desktop scrollbar-hide ${isTaskPaneClosing ? 'task-panel-animate-out' : 'task-panel-animate'}`}
            style={{ left: taskPanePosition.left - 18, right: 10, width: 'auto' }}
            data-task-panel-desktop
          >
            {/* One component for both, since task-detail-viewonly was deleted
                (task 72cb4a13). readOnly drops the editing affordances;
                canComment stays separate because a member who cannot EDIT a
                task on a collaborative list can still comment on it — the rule
                viewonly encoded and the reason it rendered a CommentSection. */}
            <LazyTaskDetail
              {...taskDetailPaneProps({
                task: selectedTask, lists, selectedListId, tasks, finalFilteredTasks,
                user: effectiveSession.user, displayMode: taskDisplayMode,
                handleUpdateTask, handleLocalUpdateTask, handleDeleteTask, handleCopyTask,
                handleToggleTaskComplete, handleCreateTask,
              })}
              onClose={closeTaskDetail}
              selectedTaskElement={selectedTaskElement}
              allowFullScreen
            />
          </div>
        )
      })()}

      {/* Mobile Settings Detail Pane - full screen */}
      {layout.showMobileSettingsDetailPane && settingsSubPage && (
        <div className="task-panel-mobile task-panel-mobile-open">
          <LazySettingsDetailPanel
            page={settingsSubPage}
            onNavigate={onNavigateSettings}
            onClose={onCloseSettingsSubPage}
          />
        </div>
      )}

      {/* Mobile Task Pane - takes over mobile view */}
      {layout.showMobileTaskPane && selectedTask && effectiveSession?.user && (() => {
        // Determine if user can edit this specific task based on list permissions and task creator
        const taskList = selectedTask.lists?.[0] || lists.find(l => l.id === selectedListId)
        const canEdit = taskList ? canUserEditTask(effectiveSession.user, selectedTask, taskList) : true

        return (
          <div
            className={`task-panel-mobile ${
              isMobileTaskDetailClosing
                ? 'task-panel-mobile-closing'
                : isMobileTaskDetailOpen
                  ? 'task-panel-mobile-open'
                  : '' // Initial state: no class = translateX(100%) from base CSS
            }`}
            style={taskDetailDragOffset > 0 ? {
              // Real-time drag feedback: panel follows finger
              transform: `translateX(${taskDetailDragOffset}px)`,
              // Disable transition during drag for immediate response
              transition: 'none',
            } : undefined}
          >
            <LazyTaskDetail
              {...taskDetailPaneProps({
                task: selectedTask, lists, selectedListId, tasks, finalFilteredTasks,
                user: effectiveSession.user, displayMode: taskDisplayMode,
                handleUpdateTask, handleLocalUpdateTask, handleDeleteTask, handleCopyTask,
                handleToggleTaskComplete, handleCreateTask,
              })}
              onClose={handleMobileBack}
              selectedTaskElement={null}
              swipeToDismiss={taskDetailSwipeToDismiss}
            />
          </div>
        )
      })()}

      {/* Enhanced Fixed Mobile Add Task at Bottom — hidden when chat is active or sidebar is open */}
      {isMobile && mobileView === 'list' && !isSettingsActive && activePanel !== 'chat' && taskViewMode !== 'board' && !showMobileSidebar && (() => {
        const selectedList = lists.find(list => list.id === selectedListId)
        const isPublicList = selectedList?.privacy === 'PUBLIC'
        const isCollaborative = selectedList?.publicListType === 'collaborative'
        const isUserOwnerOrAdmin = !!effectiveSession?.user?.id &&
          canUserManageList({ id: effectiveSession.user.id }, selectedList as never)

        // For collaborative lists, always show task creation (even when viewing from featured)
        if (isCollaborative || isUserOwnerOrAdmin) {
          return (
            <AddTaskInput
              variant="footer"
              selectedListId={selectedListId}
              availableLists={lists}
              availableUsers={availableUsers}
              currentUser={effectiveSession?.user}
              quickTaskInput={quickTaskInput}
              setQuickTaskInput={setQuickTaskInput}
              onCreateTask={handleQuickCreateTask}
              onKeyDown={handleQuickTaskKeyDown}
              isSessionReady={isSessionReady}
            />
          )
        }

        // For featured lists OR copy-only public lists (not owner/admin), show Copy List button
        if (isViewingFromFeatured || (isPublicList && !isUserOwnerOrAdmin)) {
          return (
            <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 p-4 z-30">
              <Button
                onClick={() => selectedList && handleCopyList(selectedList.id)}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white"
              >
                <Copy className="w-4 h-4 mr-2" />
                Copy List
              </Button>
            </div>
          )
        }

        // Default: show task creation
        return (
          <AddTaskInput
              variant="footer"
            selectedListId={selectedListId}
            availableLists={lists}
            availableUsers={availableUsers}
            currentUser={effectiveSession?.user}
            quickTaskInput={quickTaskInput}
            setQuickTaskInput={setQuickTaskInput}
            onCreateTask={handleQuickCreateTask}
            onKeyDown={handleQuickTaskKeyDown}
            isSessionReady={isSessionReady}
          />
        )
      })()}

      {/* Modals */}
      {showAddListModal && (
        <LazyAddListModal
          onClose={() => setShowAddListModal(false)}
          onCreateList={handleCreateList}
          currentUser={effectiveSession?.user}
        />
      )}

      {showPublicBrowser && (
        <LazyPublicListsBrowser
          isOpen={showPublicBrowser}
          onClose={() => setShowPublicBrowser(false)}
          onListCopied={handleListCopied}
        />
      )}

      {/* Keyboard Shortcuts Menu */}
      {showHotkeyMenu && (
        <LazyKeyboardShortcutsMenu
          isOpen
          onClose={() => setShowHotkeyMenu(false)}
        />
      )}

      {/* Command Palette Dialog */}
      {showCommandPalette && (
        <LazyCommandPaletteDialog
          isOpen
          onClose={() => setShowCommandPalette(false)}
          onExecuteCommand={handleExecuteCommand}
          selectedTask={selectedTask}
          handlers={keyboardShortcutHandlers}
        />
      )}
    </div>
  )
})

export { TaskManagerView }
