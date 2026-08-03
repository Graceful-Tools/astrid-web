"use client"

import { BRAND } from '@/lib/brand/config'
import React from "react"
import { createPortal } from "react-dom"
import { useTaskManagerController } from "@/hooks/useTaskManagerController"
import { useTaskManagerLayout } from "@/hooks/useTaskManagerLayout"
import { useTaskManagerModals } from "@/hooks/useTaskManagerModals"
import { ReminderProvider } from "@/components/reminder-provider"
import { ImagePicker } from "@/components/image-picker"
import { OwnerLeaveDialog } from "@/components/owner-leave-dialog"
import { TaskManagerView } from "./TaskManagerView"
import { getAllListMembers } from "@/lib/list-member-utils"
import { useToast } from "@/hooks/use-toast"
import { useListChatChannel } from "@/hooks/use-list-chat-channel"
import { userCanRequestListChatChannel } from "@/lib/chat-channel-eligibility"
import type { TaskList, User } from "@/types/task"

interface TaskManagerProps {
  initialSelectedListId?: string
  initialSelectedTaskId?: string
  initialSettingsPage?: string
  listMetadata?: any
  taskMetadata?: any
}

/**
 * TaskManager - Modern MVC Architecture
 *
 * This component implements clean separation of concerns:
 * 1. Controller layer: All business logic, state management, and API calls
 * 2. Layout layer: Responsive behavior, mobile/desktop differences
 * 3. Modal layer: Dialog and popup management
 * 4. View layer: Pure presentation component
 *
 * Benefits:
 * - Easier testing (can test business logic separately from UI)
 * - React Native compatibility (swap out view layer)
 * - Better code organization and maintainability
 * - Clearer separation of responsibilities
 */
export function TaskManager({
  initialSelectedListId,
  initialSelectedTaskId,
  initialSettingsPage,
  listMetadata,
  taskMetadata
}: TaskManagerProps) {
  // Toast notifications
  const { toast } = useToast()

  // Temporary refs to pass functions to layout hook
  const loadDataRef = React.useRef<(() => Promise<void>) | null>(null)
  const searchClearRef = React.useRef<(() => void) | null>(null)

  // UI layout and responsive behavior
  const layout = useTaskManagerLayout({
    onRefresh: async () => {
      if (loadDataRef.current) {
        await loadDataRef.current()
      }
    },
    onSearchClear: () => {
      if (searchClearRef.current) {
        searchClearRef.current()
      }
    }
  })

  // Business logic and data management
  const controller = useTaskManagerController({
    initialSelectedListId,
    initialSelectedTaskId,
    initialSettingsPage,
    listMetadata,
    taskMetadata,
    isMobile: layout.isMobile,
    is1Column: layout.is1Column,
    setMobileView: layout.setMobileView,
    handleMobileBack: layout.handleMobileBack
  })

  // Update refs for layout hook
  React.useEffect(() => {
    loadDataRef.current = controller.loadData
    searchClearRef.current = () => controller.setSearchValue("")
  }, [controller])

  // Chat channel resolution — skip API when client knows list has no chat (e.g. copy-only public browse)
  const isVirtualList = ['my-tasks', 'today', 'not-in-list', 'public', 'assigned'].includes(controller.selectedListId)
  const selectedListForChat = React.useMemo(() => {
    const id = controller.selectedListId
    if (!id || isVirtualList) return null
    return (
      controller.lists.find((l) => l.id === id) ??
      controller.publicLists?.find((l) => l.id === id) ??
      (listMetadata && (listMetadata as { id?: string }).id === id ? (listMetadata as TaskList) : null)
    )
  }, [controller.selectedListId, controller.lists, controller.publicLists, listMetadata, isVirtualList])

  const uid = controller.effectiveSession?.user?.id
  const chatChannelEnabled =
    !!uid &&
    (isVirtualList || userCanRequestListChatChannel(selectedListForChat, uid))

  const { channelId: chatChannelId, isLoading: chatChannelLoading } = useListChatChannel({
    listId: isVirtualList ? null : controller.selectedListId,
    virtualListType: isVirtualList ? controller.selectedListId : null,
    userId: uid,
    enabled: chatChannelEnabled,
  })

  // Fetch Astrid agent for mention autocomplete — always available regardless of default setting
  const [defaultAgentUser, setDefaultAgentUser] = React.useState<User | null>(null)
  React.useEffect(() => {
    if (!controller.effectiveSession?.user?.id) return
    // Fetch available agents — this also ensures astrid@astrid.cc exists in the DB
    fetch('/api/user/available-agents')
      .then(r => r.json())
      .then((data) => {
        // Find Astrid (always first in the list if user has any API key)
        const astrid = (data.agents || []).find((a: { email: string }) => a.email === `astrid@${BRAND.agentEmailDomain}`)
        if (astrid) {
          setDefaultAgentUser({
            id: astrid.id,
            name: astrid.name,
            email: astrid.email,
            image: astrid.image,
            createdAt: new Date(),
            isAIAgent: true,
          })
        }
      })
      .catch(() => {})
  }, [controller.effectiveSession?.user?.id])

  // Chat list members for mention system — includes the configured default agent
  const chatListMembers = React.useMemo((): User[] => {
    let members: User[]
    if (isVirtualList) {
      members = controller.availableUsers || []
    } else {
      const list = controller.lists.find(l => l.id === controller.selectedListId)
      if (!list) return defaultAgentUser ? [defaultAgentUser] : []
      members = getAllListMembers(list).map(m => ({
        id: m.id,
        name: m.name,
        email: m.email,
        image: m.image,
        createdAt: new Date(),
      }))
    }

    // Inject the default agent if not already in the list
    if (defaultAgentUser && !members.some(m => m.id === defaultAgentUser.id)) {
      members = [defaultAgentUser, ...members]
    }

    return members
  }, [controller.selectedListId, controller.lists, controller.availableUsers, isVirtualList, defaultAgentUser])

  // Modal and dialog management
  const modals = useTaskManagerModals()
  const {
    showAddListModal,
    showPublicBrowser,
    editingListName,
    editingListDescription,
    quickTaskInput,
    setQuickTaskInput,
    setShowSettingsPopover,
    showOwnerLeaveDialog,
    listToLeave,
    openOwnerLeaveDialog,
    closeOwnerLeaveDialog
  } = modals

  const {
    selectedTaskId,
    closeTaskDetail,
    handleQuickCreateTask
  } = controller

  // Close task details when modals open (TaskManagerV2 specific logic)
  React.useEffect(() => {
    if (selectedTaskId) {
      // Close task detail when opening modals managed by useTaskManagerModals
      if (showAddListModal || showPublicBrowser ||
          editingListName || editingListDescription) {
        closeTaskDetail()
      }
    }
  }, [
    selectedTaskId,
    closeTaskDetail,
    showAddListModal,
    showPublicBrowser,
    editingListName,
    editingListDescription
  ])

  // Create mobile task handlers that use the modals quickTaskInput state
  const handleQuickTaskKeyDown = React.useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && quickTaskInput.trim()) {
      e.preventDefault()
      handleQuickCreateTask(quickTaskInput.trim()).then(() => {
        setQuickTaskInput("")
      })
    }
  }, [quickTaskInput, handleQuickCreateTask, setQuickTaskInput])

  const handleAddTaskButtonClick = React.useCallback(() => {
    if (quickTaskInput.trim()) {
      handleQuickCreateTask(quickTaskInput.trim()).then(() => {
        setQuickTaskInput("")
      })
    }
  }, [quickTaskInput, handleQuickCreateTask, setQuickTaskInput])

  // Handler to close task details when list settings is opened
  const handleShowSettingsPopover = React.useCallback((listId: string | null) => {
    // Close task detail pane when opening list settings
    if (listId) {
      closeTaskDetail()
    }
    setShowSettingsPopover(listId)
  }, [closeTaskDetail, setShowSettingsPopover])

  // Wrapped handleLeaveList that opens dialog when owner is leaving
  const handleLeaveListWithDialog = React.useCallback(async (list: TaskList, isOwnerLeaving?: boolean) => {
    if (isOwnerLeaving) {
      // Get members to check if there are other admins
      const allMembers = getAllListMembers(list)
      const hasOtherAdmins = allMembers.some(
        m => m.id !== controller.effectiveSession?.user?.id && (m.role === 'admin' || m.role === 'owner')
      )
      openOwnerLeaveDialog(list, hasOtherAdmins)
    } else {
      // Non-owner leaving - use original handler
      await controller.handleLeaveList(list, false)
    }
  }, [controller, openOwnerLeaveDialog])

  // Handler for transfer ownership and leave
  const handleTransferAndLeave = React.useCallback(async (successorId: string) => {
    if (!listToLeave) return

    try {
      // Call the transfer-ownership API
      const response = await fetch(`/api/lists/${listToLeave.id}/transfer-ownership`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newOwnerId: successorId })
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to transfer ownership')
      }

      // Remove the list from local state (user no longer has access)
      controller.setLists((prevLists: TaskList[]) => prevLists.filter(l => l.id !== listToLeave.id))

      // Switch to a different list if this was the selected list
      if (controller.selectedListId === listToLeave.id) {
        const remainingLists = controller.lists.filter(l => l.id !== listToLeave.id)
        const nextListId = remainingLists.length > 0 ? remainingLists[0].id : 'all'
        controller.setSelectedListId(nextListId)
      }

      toast({
        title: "Success",
        description: `Ownership transferred and you have left "${listToLeave.name}"`,
        duration: 2000,
      })

      closeOwnerLeaveDialog()
    } catch (error) {
      console.error('Error transferring ownership:', error)
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to transfer ownership",
        variant: "destructive",
        duration: 3000,
      })
    }
  }, [listToLeave, controller, closeOwnerLeaveDialog, toast])

  // Handler for deleting list from owner leave dialog
  const handleDeleteListFromDialog = React.useCallback(async () => {
    if (!listToLeave) return

    try {
      await controller.handleDeleteList(listToLeave.id)
      closeOwnerLeaveDialog()
    } catch (error) {
      console.error('Error deleting list:', error)
    }
  }, [listToLeave, controller, closeOwnerLeaveDialog])

  // Get members for the owner leave dialog in the format it expects
  const dialogMembers = React.useMemo(() => {
    if (!listToLeave) return []
    const allMembers = getAllListMembers(listToLeave)
    return allMembers
      .filter(m => !m.isOwner) // Exclude owner
      .map(m => ({
        user_id: m.id,
        type: 'member' as const,
        role: m.role === 'admin' ? 'admin' : 'member',
        name: m.name,
        email: m.email,
        image: m.image
      }))
  }, [listToLeave])

  // The view component receives all data and handlers as props
  // This makes it completely testable and React Native compatible
  return (
    <ReminderProvider
      currentUser={controller.effectiveSession?.user}
      tasks={controller.tasks}
      onTaskComplete={controller.handleToggleTaskComplete}
      onTaskUpdate={controller.handleUpdateTask}
    >
      <TaskManagerView
      // Core data
      tasks={controller.tasks}
      lists={controller.lists}
      publicTasks={[]}
      publicLists={controller.publicLists}
      collaborativePublicLists={controller.collaborativePublicLists || []}
      suggestedPublicLists={controller.suggestedPublicLists || []}
      loading={controller.loading}
      selectedTaskId={controller.selectedTaskId}
      selectedListId={controller.selectedListId}
      selectedTask={controller.selectedTask || null}
      finalFilteredTasks={controller.finalFilteredTasks}
      availableUsers={controller.availableUsers}
      isSessionReady={controller.isSessionReady}
      effectiveSession={controller.effectiveSession}
      newFilterState={controller.newFilterState}
      isViewingFromFeatured={controller.isViewingFromFeatured}
      activeView={controller.activeView}
      settingsPage={controller.settingsPage}
      isSettingsActive={controller.isSettingsActive}
      settingsSubPage={controller.settingsSubPage}
      isSearchActive={controller.isSearchActive}
      onNavigateSettings={controller.navigateToSettings}
      onExitSettings={controller.exitSettings}
      onCloseSettingsSubPage={controller.closeSettingsSubPage}
      onSelectSearch={controller.selectSearch}
      onExitSearch={controller.exitSearch}

      // Task panel animation state
      isTaskPaneClosing={controller.isTaskPaneClosing}
      taskPanePosition={controller.taskPanePosition}
      setTaskPanePosition={controller.setTaskPanePosition}
      selectedTaskElement={controller.selectedTaskElement}

      // Count functions
      getTaskCountForListMemo={controller.getTaskCountForListMemo}
      getSavedFilterTaskCountMemo={controller.getSavedFilterTaskCountMemo}
      getFixedListTaskCountMemo={controller.getFixedListTaskCountMemo}
      getSelectedListInfo={controller.getSelectedListInfo}

      // Permission functions
      canEditListSettingsMemo={controller.canEditListSettingsMemo}

      // Utility functions

      // Refs
      isKeyboardScrollingRef={controller.isKeyboardScrollingRef}
      sidebarRef={layout.sidebarRef}
      taskManagerRef={layout.taskManagerRef}

      // Layout props
      layoutType={layout.layoutType}
      columnCount={layout.columnCount}
      is1Column={layout.is1Column}
      is2Column={layout.is2Column}
      is3Column={layout.is3Column}
      isMobile={layout.isMobile}
      mobileView={layout.mobileView}
      showHamburgerMenu={layout.showHamburgerMenu}
      showMobileSidebar={layout.showMobileSidebar}
      mobileSearchMode={layout.mobileSearchMode}
      justReturnedFromTaskDetail={layout.justReturnedFromTaskDetail}
      isMobileTaskDetailClosing={layout.isMobileTaskDetailClosing}
      isMobileTaskDetailOpen={layout.isMobileTaskDetailOpen}
      taskDetailDragOffset={layout.taskDetailDragOffset}

      // Layout handlers
      toggleMobileSidebar={layout.toggleMobileSidebar}
      handleMobileBack={layout.handleMobileBack}
      handleMobileSearchStart={layout.handleMobileSearchStart}
      handleMobileSearchEnd={layout.handleMobileSearchEnd}
      handleMobileSearchClear={layout.handleMobileSearchClear}
      handleMobileSearchKeyDown={layout.handleMobileSearchKeyDown}
      swipeHandlers={layout.swipeHandlers}
      sidebarSwipeToDismiss={layout.sidebarSwipeToDismiss}
      taskDetailSwipeToDismiss={layout.taskDetailSwipeToDismiss}
      pullToRefresh={layout.pullToRefresh}

      // Modal props
      showAddListModal={modals.showAddListModal}
      showPublicBrowser={modals.showPublicBrowser}
      quickTaskInput={modals.quickTaskInput}
      searchValue={controller.searchValue}
      editingListName={modals.editingListName}
      tempListName={modals.tempListName}
      editingListDescription={modals.editingListDescription}
      tempListDescription={modals.tempListDescription}
      showSettingsPopover={modals.showSettingsPopover}
      showLeaveListMenu={modals.showLeaveListMenu}

      // State setters
      setQuickTaskInput={modals.setQuickTaskInput}
      setSearchValue={controller.setSearchValue}
      setShowAddListModal={modals.setShowAddListModal}
      setSelectedListId={controller.setSelectedListId}
      setLists={controller.setLists}
      setEditingListName={modals.setEditingListName}
      setTempListName={modals.setTempListName}
      setEditingListDescription={modals.setEditingListDescription}
      setTempListDescription={modals.setTempListDescription}
      setShowSettingsPopover={handleShowSettingsPopover}
      setShowLeaveListMenu={modals.setShowLeaveListMenu}
      setShowMobileSidebar={layout.setShowMobileSidebar}

      // Methods
      loadData={controller.loadData}
      handleTaskClick={controller.handleTaskClick}
      handleUpdateTask={controller.handleUpdateTask}
      handleLocalUpdateTask={controller.handleLocalUpdateTask}
      handleToggleTaskComplete={controller.handleToggleTaskComplete}
      handleDeleteTask={controller.handleDeleteTask}
      closeTaskDetail={controller.closeTaskDetail}
      handleCreateTask={controller.handleCreateTask}
      handleQuickCreateTask={controller.handleQuickCreateTask}
      handleCreateNewTask={controller.handleCreateNewTask}
      handleCreateList={controller.handleCreateList}
      handleCopyList={controller.handleCopyList}
      handleCopyTask={controller.handleCopyTask}
      handleDeleteList={controller.handleDeleteList}
      handleUpdateList={controller.handleUpdateList}
      handleToggleListFavorite={controller.handleToggleListFavorite}
      handleLeaveList={handleLeaveListWithDialog}
      handleQuickTaskKeyDown={handleQuickTaskKeyDown}
      handleAddTaskButtonClick={handleAddTaskButtonClick}

      // Image picker props
      showImagePicker={controller.showImagePicker}
      selectedListForImagePicker={controller.selectedListForImagePicker}

      // Image picker handlers
      handleListImageClick={controller.handleListImageClick}
      handleImagePickerSelect={controller.handleImagePickerSelect}
      handleImagePickerCancel={controller.handleImagePickerCancel}

      // Keyboard shortcut handlers
      handleSelectNextTask={controller.handleSelectNextTask}
      handleSelectPreviousTask={controller.handleSelectPreviousTask}
      handleToggleTaskPanel={controller.handleToggleTaskPanel}
      handleCycleListFilters={controller.handleCycleListFilters}
      handleJumpToDate={controller.handleJumpToDate}
      handleNewTask={controller.handleNewTask}
      handleCompleteTask={controller.handleCompleteTask}
      handlePostponeTask={controller.handlePostponeTask}
      handleRemoveDueDate={controller.handleRemoveDueDate}
      handleSetPriority={controller.handleSetPriority}
      handleMakeDueDateEarlier={controller.handleMakeDueDateEarlier}
      handleMakeDueDateLater={controller.handleMakeDueDateLater}
      handleEditTaskLists={controller.handleEditTaskLists}
      handleEditTaskTitle={controller.handleEditTaskTitle}
      handleEditTaskDescription={controller.handleEditTaskDescription}
      handleAddTaskComment={controller.handleAddTaskComment}
      handleAssignToNoOne={controller.handleAssignToNoOne}
      handleShowHotkeyMenu={controller.handleShowHotkeyMenu}
      handleTaskDragStart={controller.handleTaskDragStart}
      handleTaskDragHover={controller.handleTaskDragHover}
      handleTaskDragLeaveTask={controller.handleTaskDragLeaveTask}
      handleTaskDragHoverEnd={controller.handleTaskDragHoverEnd}
      handleTaskDragEnd={controller.handleTaskDragEnd}
      handleTaskDropOnList={controller.handleTaskDropOnList}
      handleListDragEnter={controller.handleListDragEnter}
      handleListDragLeave={controller.handleListDragLeave}
      handleListDragOver={controller.handleListDragOver}
      activeDragTaskId={controller.activeDragTaskId}
      dragOverListId={controller.dragOverListId}
      isShiftDrag={controller.isShiftDrag}
      dragTargetTaskId={controller.dragTargetTaskId}
      dragTargetPosition={controller.dragTargetPosition}
      manualSortActive={controller.manualSortActive}
      manualSortPreviewActive={controller.manualSortPreviewActive}
      showHotkeyMenu={controller.showHotkeyMenu}
      setShowHotkeyMenu={controller.setShowHotkeyMenu}
      handleListCopied={controller.handleListCopied}
      setShowPublicBrowser={modals.setShowPublicBrowser}

      // Chat
      activePanel={layout.activePanel}
      setActivePanel={layout.setActivePanel}
      chatChannelId={chatChannelId}
      chatChannelLoading={chatChannelLoading}
      chatListMembers={chatListMembers}
      chatListId={isVirtualList ? null : controller.selectedListId}
      setLayoutBoardMode={layout.setIsBoardMode}
      />

      {/* Image Picker Modal */}
      {controller.showImagePicker && controller.selectedListForImagePicker && typeof window !== 'undefined' && createPortal((
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]">
          <ImagePicker
            currentImageUrl={controller.selectedListForImagePicker.imageUrl || undefined}
            onSelectImage={controller.handleImagePickerSelect}
            onCancel={controller.handleImagePickerCancel}
            listName={controller.selectedListForImagePicker.name}
            listId={controller.selectedListForImagePicker.id}
          />
        </div>
      ), document.body)}

      {/* Owner Leave Dialog - for transferring ownership */}
      {showOwnerLeaveDialog && listToLeave && controller.effectiveSession?.user && (
        <OwnerLeaveDialog
          list={listToLeave}
          members={dialogMembers}
          currentUser={controller.effectiveSession.user}
          open={showOwnerLeaveDialog}
          onClose={closeOwnerLeaveDialog}
          onTransferAndLeave={handleTransferAndLeave}
          onDeleteList={handleDeleteListFromDialog}
        />
      )}

    </ReminderProvider>
  )
}

export default TaskManager
