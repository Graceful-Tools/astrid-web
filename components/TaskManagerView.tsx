"use client"

import React, { memo } from "react"
import { TaskManagerHeader } from "./TaskManager/Header/TaskManagerHeader"
import { LeftSidebar } from "./TaskManager/Sidebar/LeftSidebar"
import { MainContent } from "./TaskManager/MainContent/MainContent"
import { OwnerLeaveDialog } from "./owner-leave-dialog"
import { AddListModal } from "./add-list-modal"
import { PublicListsBrowser } from "./public-lists-browser"
import { LoadingScreen } from "./loading-screen"
import { ImagePicker } from "./image-picker"
import { TaskDetail } from "./task-detail"
import { TaskDetailViewOnly } from "./task-detail-viewonly"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Copy } from "lucide-react"
import { useKeyboardShortcuts, type KeyboardShortcutHandlers } from "@/hooks/useKeyboardShortcuts"
import { EnhancedTaskCreation } from "./enhanced-task-creation"
import { MobileQuickAdd } from "./mobile-quick-add"
import { KeyboardShortcutsMenu } from "./keyboard-shortcuts-menu"
import type { Task, TaskList, User } from "@/types/task"
import type { LayoutType } from "@/lib/layout-detection"
import { isMobilePhoneDevice } from "@/lib/layout-detection"
import { canUserEditTask } from "@/lib/list-permissions"

interface TaskManagerViewProps {
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
  selectedTask: Task | null
  finalFilteredTasks: Task[]
  availableUsers: User[]
  isSessionReady: boolean
  effectiveSession: any
  newFilterState: any
  isViewingFromFeatured: boolean

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
  getPriorityColor: (priority: number) => string

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
  mobileView: 'list' | 'task'
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
  setShowLeaveListMenu: (value: string | null) => void
  setShowMobileSidebar: (value: boolean) => void

  // Business logic methods
  loadData: () => Promise<void>
  handleTaskClick: (taskId: string, taskElement?: HTMLElement) => void
  handleUpdateTask: (task: Task) => void
  handleLocalUpdateTask: (task: Task) => void
  handleToggleTaskComplete: (taskId: string) => Promise<void>
  handleDeleteTask: (taskId: string) => void
  closeTaskDetail: () => void
  handleCreateTask: (taskTitle: string) => Promise<string | null>
  handleQuickCreateTask: (title: string, options?: { priority?: number; assigneeId?: string | null; navigateToDetail?: boolean }) => Promise<string | null>
  handleCreateNewTask: () => void
  handleCreateList: (listData: { name: string; description: string; memberEmails: string[] }) => Promise<void>
  handleCopyList: (listId: string) => Promise<void>
  handleCopyTask: (taskId: string, targetListId?: string, includeComments?: boolean) => Promise<void>
  handleDeleteList: (listId: string) => Promise<void>
  handleUpdateList: (updatedList: TaskList) => Promise<void>
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

  // Mobile quick task handlers
  handleQuickTaskKeyDown: (e: React.KeyboardEvent) => void
  handleAddTaskButtonClick: () => void

  // Image picker handlers
  handleListImageClick: (listId: string) => void
  handleImagePickerSelect: (imageUrl: string, type: 'placeholder' | 'custom' | 'generated') => void
  handleImagePickerCancel: () => void
  showImagePicker: boolean
  selectedListForImagePicker: TaskList | null

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
  handleShowHotkeyMenu: () => void

  // Hotkey menu state
  showHotkeyMenu: boolean
  setShowHotkeyMenu: (show: boolean) => void

  // Public browser handlers
  handleListCopied: (copiedList: any) => Promise<void>
  setShowPublicBrowser: (show: boolean) => void

  // TODO: Add more props as needed
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
  getTaskCountForListMemo,
  getSavedFilterTaskCountMemo,
  getFixedListTaskCountMemo,
  getSelectedListInfo,
  canEditListSettingsMemo,
  getPriorityColor,
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
  setShowLeaveListMenu,
  setShowMobileSidebar,
  loadData,
  handleTaskClick,
  handleUpdateTask,
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
  handleImagePickerSelect,
  handleImagePickerCancel,
  showImagePicker,
  selectedListForImagePicker,
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
  handleShowHotkeyMenu,
  showHotkeyMenu,
  setShowHotkeyMenu,
  handleListCopied,
  setShowPublicBrowser,
}: TaskManagerViewProps) {
  const autoOpenedSidebarRef = React.useRef(false)

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
      if (sidebarRef.current && taskManagerRef.current && selectedTaskId && !is1Column) {
        const sidebarRect = sidebarRef.current.getBoundingClientRect()
        const taskManagerRect = taskManagerRef.current.getBoundingClientRect()

        // Layout-aware positioning:
        // - 1-column: No task panel (handled by !is1Column condition)
        // - 2-column: Task panel positioned after main content (sidebar hidden or hamburger)
        // - 3-column: Task panel positioned after sidebar + main content
        let leftOffset: number

        if (is2Column) {
          // 2-column layout: Sidebar is hamburger menu, task panel after main content
          leftOffset = taskManagerRect.width + 20
        } else if (is3Column) {
          // 3-column layout: Task panel after visible sidebar + main content
          leftOffset = sidebarRect.width + taskManagerRect.width + 20
        } else {
          // Fallback to original logic for edge cases
          leftOffset = showHamburgerMenu
            ? taskManagerRect.width + 20
            : sidebarRect.width + taskManagerRect.width + 20
        }

        // Update the task pane position
        setTaskPanePosition({ left: leftOffset })
      }
    }

    calculatePosition()
    window.addEventListener('resize', calculatePosition)

    return () => {
      window.removeEventListener('resize', calculatePosition)
    }
  }, [selectedTaskId, is1Column, is2Column, is3Column, showHamburgerMenu, setTaskPanePosition, sidebarRef, taskManagerRef])

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
    onShowHotkeyMenu: handleShowHotkeyMenu,
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

  // Show loading screen if no session (on all devices)
  if (!effectiveSession?.user) {
    return <LoadingScreen />
  }

  // iOS drawer: sidebar is always rendered, content slides to reveal it
  // Works on mobile AND 2-column view (anywhere hamburger menu is shown)
  const isIOSDrawer = showHamburgerMenu

  return (
    <div className="app-container theme-bg-primary theme-text-primary">
      {/* Mobile Sidebar - rendered outside content wrapper for iOS drawer effect */}
      {isIOSDrawer && (
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
      <div className={`flex flex-col h-full ${isIOSDrawer ? `ios-drawer-content ${showMobileSidebar ? 'ios-drawer-content-open' : ''}` : ''}`}>
        {/* Header */}
        <TaskManagerHeader
          isMobile={isMobile}
          showHamburgerMenu={showHamburgerMenu}
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
          onShowKeyboardShortcuts={handleShowHotkeyMenu}
          isTaskDragActive={Boolean(activeDragTaskId)}
          onHamburgerDragHover={handleHamburgerDragHover}
        />

        {/* Main Layout */}
        <div className={`flex flex-1 min-h-0 app-body ${isIOSDrawer ? 'app-body-with-floating-header' : ''}`} {...swipeHandlers}>
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

        {/* Main Content */}
        <MainContent
          isMobile={isMobile}
          mobileView={mobileView}
          isMobileTaskDetailClosing={isMobileTaskDetailClosing}
          is2Column={is2Column}
          is3Column={is3Column}
          selectedListId={selectedListId}
          lists={lists}
          finalFilteredTasks={finalFilteredTasks}
          listMetadata={{}}
          effectiveSession={effectiveSession}
          availableUsers={availableUsers}
          newFilterState={newFilterState}
          selectedTaskId={selectedTaskId}
          isViewingFromFeatured={isViewingFromFeatured}
          showSettingsPopover={showSettingsPopover}
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
          handleToggleTaskComplete={handleToggleTaskComplete}
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
          closeTaskDetail={closeTaskDetail}
          canEditListSettingsMemo={canEditListSettingsMemo}
          getSelectedListInfo={getSelectedListInfo}
          getPriorityColor={getPriorityColor}
          taskManagerRef={taskManagerRef}
          isKeyboardScrollingRef={isKeyboardScrollingRef}
          onListUpdate={handleUpdateList}
          onListDelete={handleDeleteList}
          handleCopyList={handleCopyList}
          handleCopyTask={handleCopyTask}
        />
        </div>
      </div>

      {/* iOS Drawer Overlay - tap to close sidebar */}
      {isIOSDrawer && showMobileSidebar && (
        <div
          className="ios-drawer-overlay ios-drawer-overlay-visible"
          onClick={() => setShowMobileSidebar(false)}
        />
      )}

      {/* Desktop Task Pane - positioned absolutely, slide-out from right */}
      {!is1Column && selectedTask && effectiveSession?.user && (() => {
        // Determine if user can edit this specific task based on list permissions and task creator
        const taskList = selectedTask.lists?.[0] || lists.find(l => l.id === selectedListId)
        const canEdit = taskList ? canUserEditTask(effectiveSession.user, selectedTask, taskList) : true

        return (
          <div
            className={`task-panel-desktop scrollbar-hide ${isTaskPaneClosing ? 'task-panel-animate-out' : 'task-panel-animate'}`}
            style={{ left: taskPanePosition.left }}
            data-task-panel-desktop
          >
            {canEdit ? (
              <TaskDetail
                task={selectedTask}
                currentUser={effectiveSession.user}
                availableLists={lists}
                onUpdate={handleUpdateTask}
                onLocalUpdate={handleLocalUpdateTask as ((updatedTaskOrFn: Task | ((taskId: string, currentTask: Task) => Task)) => void)}
                onDelete={handleDeleteTask}
                onClose={closeTaskDetail}
                onCopy={handleCopyTask}
                selectedTaskElement={selectedTaskElement}
                readOnly={false}
              />
            ) : (
              <TaskDetailViewOnly
                task={selectedTask}
                currentUser={effectiveSession.user}
                availableLists={lists}
                onUpdate={handleUpdateTask}
                onLocalUpdate={handleLocalUpdateTask as ((updatedTaskOrFn: Task | ((taskId: string, currentTask: Task) => Task)) => void)}
                onClose={closeTaskDetail}
                onCopy={handleCopyTask}
              />
            )}
          </div>
        )
      })()}

      {/* Mobile Task Pane - takes over mobile view */}
      {isMobile && selectedTask && effectiveSession?.user && (mobileView === 'task' || isMobileTaskDetailClosing) && (() => {
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
            {canEdit ? (
              <TaskDetail
                task={selectedTask}
                currentUser={effectiveSession.user}
                availableLists={lists}
                onUpdate={handleUpdateTask}
                onLocalUpdate={handleLocalUpdateTask as ((updatedTaskOrFn: Task | ((taskId: string, currentTask: Task) => Task)) => void)}
                onDelete={handleDeleteTask}
                onClose={handleMobileBack}
                onCopy={handleCopyTask}
                selectedTaskElement={null}
                swipeToDismiss={taskDetailSwipeToDismiss}
                readOnly={false}
              />
            ) : (
              <TaskDetailViewOnly
                task={selectedTask}
                currentUser={effectiveSession.user}
                availableLists={lists}
                onUpdate={handleUpdateTask}
                onLocalUpdate={handleLocalUpdateTask as ((updatedTaskOrFn: Task | ((taskId: string, currentTask: Task) => Task)) => void)}
                onClose={handleMobileBack}
                onCopy={handleCopyTask}
                swipeToDismiss={taskDetailSwipeToDismiss}
              />
            )}
          </div>
        )
      })()}

      {/* Enhanced Fixed Mobile Add Task at Bottom */}
      {isMobile && mobileView === 'list' && (() => {
        const selectedList = lists.find(list => list.id === selectedListId)
        const isPublicList = selectedList?.privacy === 'PUBLIC'
        const isCollaborative = selectedList?.publicListType === 'collaborative'
        const isUserOwnerOrAdmin = selectedList?.ownerId === effectiveSession?.user?.id ||
                                  selectedList?.admins?.some(admin => admin.id === effectiveSession?.user?.id)

        // For collaborative lists, always show task creation (even when viewing from featured)
        if (isCollaborative || isUserOwnerOrAdmin) {
          return (
            <MobileQuickAdd
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
          <MobileQuickAdd
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
        <AddListModal
          onClose={() => setShowAddListModal(false)}
          onCreateList={handleCreateList}
          currentUser={effectiveSession?.user}
        />
      )}

      {showPublicBrowser && (
        <PublicListsBrowser
          isOpen={showPublicBrowser}
          onClose={() => setShowPublicBrowser(false)}
          onListCopied={handleListCopied}
        />
      )}

      {/* Keyboard Shortcuts Menu */}
      <KeyboardShortcutsMenu
        isOpen={showHotkeyMenu}
        onClose={() => setShowHotkeyMenu(false)}
      />
    </div>
  )
})

export { TaskManagerView }
