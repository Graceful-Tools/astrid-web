"use client"

import React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ListSettingsPopover } from "../../list-settings-popover"
import { FixedListSettingsPopover } from "../../fixed-list-settings-popover"
import { QuickTaskCreate } from "../../quick-task-create"
import { EnhancedTaskCreation, useLayoutType } from "../../enhanced-task-creation"
import { isMobilePhoneDevice } from "@/lib/layout-detection"
import { useMobileDragSort } from "@/hooks/use-mobile-drag-sort"
import { TaskRow, type TaskRowControllerSlice } from "./TaskRow"
import { TaskViewToggle } from "../Header/TaskViewToggle"
import { VirtualizedTaskList } from "./VirtualizedTaskList"
import { shouldVirtualizeTaskList } from "@/lib/virtualize-task-list"
import { AstridEmptyState } from "@/components/ui/astrid-empty-state"
import { ProjectStatusBoard } from "@/components/project-status-board"
import { DescriptionDialog, type DescriptionDialogHandle } from "./DescriptionDialog"
import {
  Settings,
  Filter,
  Check,
  X,
  ArrowLeft,
  Copy,
  Search
} from "lucide-react"
import { renderMarkdown } from "@/lib/markdown"
import { getListImageUrl, getConsistentDefaultImage } from "@/lib/default-images"
import { getAllListMembers } from "@/lib/list-member-utils"
import type { Task, TaskList } from "@/types/task"

interface MainContentProps {
  // Layout and responsive props
  isMobile: boolean
  mobileView: 'list' | 'task' | 'chat'
  isMobileTaskDetailClosing?: boolean
  isOneColumn?: boolean
  is2Column?: boolean
  is3Column?: boolean

  // Data props
  selectedListId: string
  lists: TaskList[]
  allTasks: Task[]
  finalFilteredTasks: Task[]
  listMetadata?: any
  effectiveSession: any
  availableUsers: any[]
  isViewingFromFeatured?: boolean

  // Filter state
  newFilterState: {
    filters: {
      search: {
        trim: () => string
      }
      priority: any
      assignee: any
      dueDate: any
      completed: any
      sortBy: any
    }
    setPriority: (value: any) => void
    setAssignee: (value: any) => void
    setDueDate: (value: any) => void
    setCompleted: (value: any) => void
    setSortBy: (value: any) => void
    hasActiveFilters: boolean
    clearAllFilters: () => void
  }

  // Search
  isSearchActive?: boolean
  searchValue?: string
  onSearchChange?: (value: string) => void

  // UI state
  selectedTaskId: string
  showSettingsPopover: string | null
  setShowSettingsPopover: (value: string | null) => void
  showLeaveListMenu: string | null
  setShowLeaveListMenu: (value: string | null) => void
  editingListName: boolean
  setEditingListName: (value: boolean) => void
  tempListName: string
  setTempListName: (value: string) => void
  editingListDescription: boolean
  setEditingListDescription: (value: boolean) => void
  tempListDescription: string
  setTempListDescription: (value: string) => void
  quickTaskInput: string
  setQuickTaskInput: (value: string) => void
  recentlyChangedList: boolean
  isSessionReady: boolean
  justReturnedFromTaskDetail: boolean
  hasProjectBoard?: boolean
  taskViewMode?: 'list' | 'board'
  onTaskViewModeChange?: (mode: 'list' | 'board') => void

  // Pull to refresh
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

  // Handler functions
  handleListImageClick: (listId: string) => void
  handleEditListName: (list: TaskList) => void
  handleSaveListName: () => Promise<void>
  handleEditListDescription: (list: TaskList) => void
  handleSaveListDescription: () => Promise<void>
  handleLeaveList: (list: TaskList, isOwnerLeaving?: boolean) => Promise<void>
  handleQuickTaskKeyDown: (e: React.KeyboardEvent) => void
  handleAddTaskButtonClick: () => void
  handleTaskClick: (taskId: string, taskElement?: HTMLElement) => Promise<void>
  handleUpdateTask: (task: Task) => void
  handleLocalUpdateTask: (updatedTaskOrFn: Task | ((taskId: string, currentTask: Task) => Task)) => void
  handleToggleTaskComplete: (taskId: string) => Promise<void>
  handleDeleteTask: (taskId: string) => void
  handleQuickCreateTask: (title: string, options?: { priority?: number; assigneeId?: string | null; navigateToDetail?: boolean; listIds?: string[] }) => Promise<string | null>
  handleCreateNewTask: () => void
  handleCopyList: (listId: string) => Promise<void>
  handleCopyTask: (taskId: string, targetListId?: string, includeComments?: boolean) => Promise<void>
  closeTaskDetail: () => void

  // Drag and drop
  handleTaskDragStart: (taskId: string) => void
  handleTaskDragHover: (taskId: string, position: 'above' | 'below') => void
  handleTaskDragLeaveTask: (taskId: string) => void
  handleTaskDragHoverEnd: () => void
  handleTaskDragEnd: () => void
  activeDragTaskId: string | null
  dragTargetTaskId: string | null
  dragTargetPosition: 'above' | 'below' | 'end' | null
  manualSortActive: boolean
  manualSortPreviewActive: boolean

  // Utility functions
  canEditListSettingsMemo: (list: TaskList) => boolean
  getSelectedListInfo: () => { name: string; description: string }
  getPriorityColor: (priority: number) => string

  // Refs
  taskManagerRef: React.MutableRefObject<HTMLDivElement | null>
  isKeyboardScrollingRef: React.MutableRefObject<boolean>

  // List update handler for popovers
  onListUpdate: (updatedList: TaskList) => Promise<void>
  onProjectBoardCreated?: (projectLists: TaskList[]) => void
  onProjectBoardRemoved?: (projectId: string, detachedListIds: string[]) => void
  onStatusesChanged?: () => void
  onListDelete: (listId: string) => void
  onFavoriteToggle?: (listId: string) => void
}

export function MainContent({
  isMobile,
  mobileView,
  isMobileTaskDetailClosing,
  isOneColumn,
  is2Column,
  is3Column,
  selectedListId,
  lists,
  allTasks,
  finalFilteredTasks,
  listMetadata,
  effectiveSession,
  availableUsers,
  isViewingFromFeatured,
  newFilterState,
  isSearchActive = false,
  searchValue = '',
  onSearchChange,
  selectedTaskId,
  showSettingsPopover,
  setShowSettingsPopover,
  showLeaveListMenu,
  setShowLeaveListMenu,
  editingListName,
  setEditingListName,
  tempListName,
  setTempListName,
  editingListDescription,
  setEditingListDescription,
  tempListDescription,
  setTempListDescription,
  quickTaskInput,
  setQuickTaskInput,
  recentlyChangedList,
  isSessionReady,
  hasProjectBoard = false,
  taskViewMode = 'list',
  onTaskViewModeChange,
  pullToRefresh,
  justReturnedFromTaskDetail,
  handleListImageClick,
  handleEditListName,
  handleSaveListName,
  handleEditListDescription,
  handleSaveListDescription,
  handleLeaveList,
  handleQuickTaskKeyDown,
  handleAddTaskButtonClick,
  handleTaskClick,
  handleUpdateTask,
  handleLocalUpdateTask,
  handleToggleTaskComplete,
  handleDeleteTask,
  handleQuickCreateTask,
  handleCreateNewTask,
  handleCopyList,
  handleCopyTask,
  closeTaskDetail,
  handleTaskDragStart,
  handleTaskDragHover,
  handleTaskDragLeaveTask,
  handleTaskDragHoverEnd,
  handleTaskDragEnd,
  activeDragTaskId,
  dragTargetTaskId,
  dragTargetPosition,
  manualSortActive,
  manualSortPreviewActive,
  canEditListSettingsMemo,
  getSelectedListInfo,
  getPriorityColor,
  taskManagerRef,
  isKeyboardScrollingRef,
  onListUpdate,
  onProjectBoardCreated,
  onProjectBoardRemoved,
  onStatusesChanged,
  onListDelete,
  onFavoriteToggle
}: MainContentProps) {
  // Detect current layout type for enhanced task creation
  const layoutType = useLayoutType()

  // Description viewer/editor dialog state
  const descriptionDialogRef = React.useRef<DescriptionDialogHandle>(null)

  const [draggingTaskMetrics, setDraggingTaskMetrics] = React.useState<{ taskId: string; height: number } | null>(null)
  const taskMeasurementsRef = React.useRef<Map<string, number>>(new Map())
  const taskListContainerRef = React.useRef<HTMLDivElement | null>(null)
  const scrollContainerRef = React.useRef<HTMLDivElement | null>(null)
  const savedScrollPositionRef = React.useRef<number>(0)
  const isTouchManualSort = React.useMemo(() => isMobile && isMobilePhoneDevice(), [isMobile])
  const registerTaskRow = React.useCallback((taskId: string) => (node: HTMLDivElement | null) => {
    if (node) {
      const rect = node.getBoundingClientRect()
      taskMeasurementsRef.current.set(taskId, rect.height)
    } else {
      taskMeasurementsRef.current.delete(taskId)
    }
  }, [])

  React.useEffect(() => {
    if (!activeDragTaskId) {
      setDraggingTaskMetrics(null)
    }
  }, [activeDragTaskId])

  const handleMobileDragEnd = React.useCallback(() => {
    handleTaskDragEnd()
    setDraggingTaskMetrics(null)
  }, [handleTaskDragEnd])

  const { startMobileDrag } = useMobileDragSort({
    isTouchManualSort,
    manualSortActive,
    activeDragTaskId,
    taskListContainerRef,
    onDragHover: handleTaskDragHover,
    onDragHoverEnd: handleTaskDragHoverEnd,
    onDragEnd: handleMobileDragEnd,
  })

  // Save scroll position when entering task detail view on mobile
  React.useEffect(() => {
    if (isMobile && mobileView === 'task' && scrollContainerRef.current) {
      savedScrollPositionRef.current = scrollContainerRef.current.scrollTop
    }
  }, [isMobile, mobileView])

  // Restore scroll position when returning from task detail view
  React.useEffect(() => {
    if (justReturnedFromTaskDetail && scrollContainerRef.current) {
      // Use requestAnimationFrame to ensure DOM is ready
      requestAnimationFrame(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = savedScrollPositionRef.current
        }
      })
    }
  }, [justReturnedFromTaskDetail])

  const renderManualPlaceholderRow = (
    key: string,
    label?: string,
    options?: {
      className?: string
      style?: React.CSSProperties
    }
  ) => (
    <div
      key={key}
      aria-hidden="true"
      className={`task-row task-card transition-theme pointer-events-none border-2 border-dashed border-blue-400/70 bg-blue-500/10 text-blue-200 ${isMobile ? 'mobile-task-item' : ''} ${options?.className ?? ''}`}
      style={options?.style}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-blue-400/60" />
        <div className="flex-1 space-y-2">
          <div className="h-3 rounded bg-blue-400/40" />
          <div className="h-2 w-1/2 rounded bg-blue-400/20" />
        </div>
        {!isMobile && <div className="h-3 w-16 rounded bg-blue-400/20" />}
      </div>
      {label && (
        <div className="mt-3 text-[11px] font-medium uppercase tracking-wide text-blue-300">
          {label}
        </div>
      )}
    </div>
  )

  // Calculate parallax state for mobile transitions
  const isShowingTaskDetail = isMobile && mobileView === 'task' && !isMobileTaskDetailClosing

  // Get the current list for dialog context
  const currentListForDialog = lists.find(l => l.id === selectedListId)

  // Controller slice shared by every TaskRow (Stage 20b). Assembled from the
  // props MainContent already receives so rows take one bundle, not ~14 props.
  const rowController: TaskRowControllerSlice = {
    selectedTaskId,
    activeDragTaskId,
    dragTargetTaskId,
    dragTargetPosition,
    manualSortActive,
    manualSortPreviewActive,
    effectiveSession,
    handleTaskClick,
    handleToggleTaskComplete,
    handleCopyTask,
    handleTaskDragStart,
    handleTaskDragHover,
    handleTaskDragLeaveTask,
    handleTaskDragEnd,
  }

  // Single source of truth for a task row, shared by the plain and the
  // virtualized (very-long-list) render paths.
  const renderTaskRow = (task: Task) => (
    <TaskRow
      key={task.id}
      task={task}
      controller={rowController}
      isMobile={isMobile}
      isTouchManualSort={isTouchManualSort}
      getPriorityColor={getPriorityColor}
      draggingTaskMetrics={draggingTaskMetrics}
      registerTaskRow={registerTaskRow}
      taskMeasurementsRef={taskMeasurementsRef}
      renderManualPlaceholderRow={renderManualPlaceholderRow}
      setDraggingTaskMetrics={setDraggingTaskMetrics}
      startMobileDrag={startMobileDrag}
    />
  )

  return (
    <>
    <div className={`flex-1 min-w-0 ${isMobile ? 'relative' : 'flex'}`}>
      {/* Task List Area */}
      <div
        ref={taskManagerRef}
        className={`theme-bg-primary flex flex-col relative z-10 ${
        isMobile
          ? 'absolute inset-x-0 bottom-0 transition-all duration-300 ease-in-out'
          : 'flex-1 min-w-0'
      }`}
      style={{
        // Mobile: offset for floating header (header height + margin)
        top: isMobile ? '0px' : undefined,
        marginRight: !isMobile && typeof window !== 'undefined' && (
          /iPad/.test(window.navigator.userAgent) ||
          (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent))
        ) ? '16px' : undefined,
        // Parallax effect: slight shift and scale when task detail is open
        ...(isMobile && {
          transform: isShowingTaskDetail
            ? 'translateX(-15%) scale(0.95)'  // Parallax: subtle shift left + scale down
            : 'translateX(0) scale(1)',        // Normal: centered and full size
          opacity: isShowingTaskDetail ? 0.7 : 1,
          transformOrigin: 'left center',
        }),
      }}>
        <div
          className="px-4 py-5 theme-border border-b"
          style={{ display: is3Column && !(hasProjectBoard && taskViewMode === 'board') ? 'block' : 'none' }}
        >
          {isSearchActive ? (
            <div className="flex items-center justify-start space-x-4 mb-4">
              <div className="text-left flex-1">
                <h1 className="text-2xl font-semibold tracking-tight theme-text-primary mb-1">Search</h1>
                <p className="theme-text-muted text-sm">Find tasks and users across all lists</p>
              </div>
            </div>
          ) : (
          <>
          {/* Centered List Header with Image and Editable Name */}
          <div className="text-center mb-6">
            {selectedListId && !["my-tasks", "today", "not-in-list", "public", "assigned"].includes(selectedListId) && (
              (() => {
                const currentList = lists.find(list => list.id === selectedListId) || listMetadata
                if (!currentList) return null

                return (
                  <div className="flex items-center justify-start space-x-4 mb-4">
                    {/* List Image */}
                    <img
                      src={getListImageUrl(currentList)}
                      alt={currentList.name}
                      className={`w-16 h-16 rounded-xl object-cover ${canEditListSettingsMemo(currentList) && !isViewingFromFeatured ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
                      onClick={canEditListSettingsMemo(currentList) && !isViewingFromFeatured ? () => handleListImageClick(currentList.id) : undefined}
                      title={canEditListSettingsMemo(currentList) && !isViewingFromFeatured ? "Click to change image" : currentList.name}
                      onError={(e) => {
                        // Fallback to consistent default image on error
                        const target = e.currentTarget as HTMLImageElement
                        const fallbackImage = getConsistentDefaultImage(currentList.id).filename
                        if (target.src !== fallbackImage) {
                          target.src = fallbackImage
                        }
                      }}
                    />

                    {/* Editable List Name and Description */}
                    <div className="text-left flex-1">
                      {editingListName ? (
                        <div className="flex items-center justify-start space-x-2">
                          <Input
                            value={tempListName}
                            onChange={(e) => setTempListName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveListName()
                              if (e.key === "Escape") setEditingListName(false)
                            }}
                            className="theme-input theme-text-primary text-2xl font-semibold tracking-tight text-left max-w-md"
                            autoFocus
                          />
                          <Button size="sm" onClick={handleSaveListName} className="bg-blue-600 hover:bg-blue-700">
                            <Check className="w-4 h-4" />
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setEditingListName(false)}
                                  className="theme-border theme-text-secondary hover:theme-bg-hover">
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      ) : (
                        <h1 className={`text-2xl font-semibold tracking-tight theme-text-primary mb-1 text-left ${!newFilterState.filters.search.trim() && canEditListSettingsMemo(currentList) && !isViewingFromFeatured ? 'cursor-pointer hover:theme-text-secondary' : ''}`}
                            onClick={!newFilterState.filters.search.trim() && canEditListSettingsMemo(currentList) && !isViewingFromFeatured ? () => handleEditListName(currentList) : undefined}>
                          {newFilterState.filters.search.trim() ? 'Search Results' : currentList.name}
                          {!newFilterState.filters.search.trim() && canEditListSettingsMemo(currentList) && !isViewingFromFeatured}
                        </h1>
                      )}

                      {/* Editable Description */}
                      {editingListDescription ? (
                        <>
                          <div className="flex items-start justify-start space-x-2 mt-2">
                            <textarea
                              value={tempListDescription}
                              onChange={(e) => setTempListDescription(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  if (e.shiftKey || e.metaKey || e.ctrlKey) {
                                    // Shift+Enter, Cmd/Ctrl + Enter: Add line break
                                    return
                                  } else {
                                    // Plain Enter: Save description
                                    e.preventDefault()
                                    handleSaveListDescription()
                                  }
                                } else if (e.key === "Escape") {
                                  setEditingListDescription(false)
                                }
                              }}
                              className="theme-comment-bg theme-border border theme-text-primary text-sm text-left max-w-md rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                              placeholder="Add a description..."
                              rows={2}
                              autoFocus
                            />
                            <div className="flex flex-col space-y-1 mt-1">
                              <Button size="sm" onClick={handleSaveListDescription} className="bg-blue-600 hover:bg-blue-700">
                                <Check className="w-4 h-4" />
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => setEditingListDescription(false)}
                                      className="theme-border theme-text-secondary hover:theme-bg-hover">
                                <X className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                          <div className="text-xs theme-text-muted mt-1 ml-0">
                            Press Enter to save • Shift+Enter or Cmd/Ctrl+Enter for line breaks
                          </div>
                        </>
                      ) : (
                        <div
                          className={`theme-text-muted text-sm text-left prose prose-sm max-w-none line-clamp-2 overflow-hidden ${
                            !newFilterState.filters.search.trim() ? 'cursor-pointer hover:theme-text-secondary' : ''
                          }`}
                          onClick={!newFilterState.filters.search.trim() ? () => {
                            if (currentList.description) {
                              // Has description → open viewer dialog
                              descriptionDialogRef.current?.open(currentList.description)
                            } else if (canEditListSettingsMemo(currentList) && !isViewingFromFeatured) {
                              // No description + can edit → go straight to inline edit
                              handleEditListDescription(currentList)
                            }
                          } : undefined}
                          dangerouslySetInnerHTML={{
                            __html: newFilterState.filters.search.trim()
                              ? `Showing tasks matching "<strong>${newFilterState.filters.search}</strong>" from all accessible lists`
                              : (currentList.description ? renderMarkdown(currentList.description) : (canEditListSettingsMemo(currentList) && !isViewingFromFeatured ? "Add a description..." : ""))
                          }}
                        />
                      )}
                    </div>

                    {/* Share and Settings Buttons */}
                    <div className="flex items-center space-x-2">
                      {is3Column && hasProjectBoard && (
                        <TaskViewToggle
                          labelClassName="hidden min-[1300px]:inline"
                          isOneColumn={false}
                          hasProjectBoard={hasProjectBoard}
                          chatAvailable={false}
                          activeView="list"
                          isSearching={Boolean(newFilterState.filters.search.trim())}
                          activePanel="tasks"
                          taskViewMode={taskViewMode}
                          onTaskViewModeChange={onTaskViewModeChange}
                          onToggleActivePanel={undefined}
                        />
                      )}
                      {(() => {
                        const isPublicList = currentList?.privacy === 'PUBLIC'
                        const isUserOwnerOrAdmin = currentList?.ownerId === effectiveSession?.user?.id ||
                                                  currentList?.admins?.some((admin: any) => admin.id === effectiveSession?.user?.id)

                        // If viewing from featured lists, don't show settings regardless of ownership
                        // Or if it's a public list and user is not owner/admin
                        if (isViewingFromFeatured || (isPublicList && !isUserOwnerOrAdmin)) {
                          return null
                        }

                        // Always show settings button that opens the full popover
                        return (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              setShowSettingsPopover(selectedListId)
                            }}
                            onMouseDown={(e) => {
                              e.stopPropagation()
                            }}
                            className="theme-text-muted hover:theme-text-primary p-2"
                            data-settings-button="true"
                          >
                            <Settings className="w-5 h-5" />
                          </Button>
                        )
                      })()}
                    </div>
                  </div>
                )
              })()
            )}

            {/* Default view titles for system lists */}
            {(selectedListId === "my-tasks" || selectedListId === "today" || selectedListId === "not-in-list" || selectedListId === "public" || selectedListId === "assigned") && (
              <div className="flex items-center justify-start space-x-4 mb-4">
                <div className="text-left flex-1">
                  <h1 className="text-2xl font-semibold tracking-tight theme-text-primary mb-1">{getSelectedListInfo().name}</h1>
                  <p className="theme-text-muted text-sm">{getSelectedListInfo().description}</p>
                </div>
                <div className="flex items-center space-x-2">
                  {is3Column && hasProjectBoard && (
                    <TaskViewToggle
                      labelClassName="hidden min-[1300px]:inline"
                      isOneColumn={false}
                      hasProjectBoard={hasProjectBoard}
                      chatAvailable={false}
                      activeView="list"
                      isSearching={Boolean(newFilterState.filters.search.trim())}
                      activePanel="tasks"
                      taskViewMode={taskViewMode}
                      onTaskViewModeChange={onTaskViewModeChange}
                      onToggleActivePanel={undefined}
                    />
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      setShowSettingsPopover(selectedListId)
                    }}
                    onMouseDown={(e) => {
                      e.stopPropagation()
                    }}
                    className="theme-text-muted hover:theme-text-primary p-2"
                    data-settings-button="true"
                  >
                    <Filter className="w-5 h-5" />
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* List Settings Popover for Current List - Desktop Only */}
          {!isMobile && selectedListId && !["my-tasks", "today", "not-in-list", "public", "assigned"].includes(selectedListId) && (
            (() => {
              const currentList = lists.find(list => list.id === selectedListId) || listMetadata
              if (!currentList) return null

              return showSettingsPopover === currentList.id && (
                <ListSettingsPopover
                  key={`settings-current-${currentList.id}`}
                  list={currentList}
                  currentUser={effectiveSession?.user}
                  availableUsers={availableUsers}
                  canEditSettings={canEditListSettingsMemo(currentList) && !isViewingFromFeatured}
                  open={showSettingsPopover === selectedListId}
                  onOpenChange={(open) => setShowSettingsPopover(open ? selectedListId : null)}
                  onEditImage={() => handleListImageClick(currentList.id)}
                  onLeave={(list, isOwnerLeaving) => handleLeaveList(list, isOwnerLeaving)}
                  onUpdate={onListUpdate}
                  onFavoriteToggle={onFavoriteToggle}
                  onProjectBoardCreated={onProjectBoardCreated}
                  onProjectBoardRemoved={onProjectBoardRemoved}
                  onDelete={(listId) => {
                    onListDelete(listId)
                    setShowSettingsPopover(null)
                  }}
                >
                  <div />
                </ListSettingsPopover>
              )
            })()
          )}

          {/* Fixed List Settings Popover for System Lists - Desktop Only */}
          {!isMobile && ["my-tasks", "today", "not-in-list", "public", "assigned"].includes(selectedListId) && (
            <FixedListSettingsPopover
              key={`fixed-settings-${selectedListId}`}
              listId={selectedListId}
              listName={getSelectedListInfo().name}
              listDescription={getSelectedListInfo().description}
              currentUser={effectiveSession?.user}
              availableUsers={availableUsers}
              open={showSettingsPopover === selectedListId}
              onOpenChange={(open) => setShowSettingsPopover(open ? selectedListId : null)}
              filterPriority={newFilterState.filters.priority}
              setFilterPriority={newFilterState.setPriority}
              filterAssignee={newFilterState.filters.assignee}
              setFilterAssignee={newFilterState.setAssignee}
              filterDueDate={newFilterState.filters.dueDate}
              setFilterDueDate={newFilterState.setDueDate}
              filterCompletion={newFilterState.filters.completed}
              setFilterCompletion={newFilterState.setCompleted}
              sortBy={newFilterState.filters.sortBy}
              setSortBy={newFilterState.setSortBy}
              hasActiveFilters={newFilterState.hasActiveFilters}
              clearAllFilters={newFilterState.clearAllFilters}
            />
          )}
          </>
          )}

          {/* Search Input - shown when search is active */}
          {isSearchActive && onSearchChange && (
            <div className="py-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 theme-text-muted" />
                <Input
                  placeholder="Search tasks and users..."
                  value={searchValue}
                  onChange={(e) => onSearchChange(e.target.value)}
                  className="theme-input theme-text-primary pl-10 w-full"
                  autoComplete="off"
                  autoFocus
                />
              </div>
            </div>
          )}

          {/* Enhanced Task Input - Desktop only (mobile version is fixed at bottom) */}
          {!isSearchActive && !isMobile && !(hasProjectBoard && taskViewMode === 'board') && (() => {
            const selectedList = lists.find(list => list.id === selectedListId)
            const isPublicList = selectedList?.privacy === 'PUBLIC'
            const isCollaborative = selectedList?.publicListType === 'collaborative'
            const isUserOwnerOrAdmin = selectedList?.ownerId === effectiveSession?.user?.id ||
                                      selectedList?.admins?.some(admin => admin.id === effectiveSession?.user?.id)

            // For collaborative lists, always show task creation (even when viewing from featured)
            if (isCollaborative || isUserOwnerOrAdmin) {
              return (
                <div>
                  <EnhancedTaskCreation
                    layoutType={layoutType}
                    selectedListId={selectedListId}
                    availableLists={lists}
                    quickTaskInput={quickTaskInput}
                    setQuickTaskInput={setQuickTaskInput}
                    onCreateTask={handleQuickCreateTask}
                    onKeyDown={handleQuickTaskKeyDown}
                    isMobile={isMobilePhoneDevice()}
                    isSessionReady={isSessionReady}
                    className="w-full"
                  />
                </div>
              )
            }

            // For featured lists OR copy-only public lists (not owner/admin), show Copy List button
            if (isViewingFromFeatured || (isPublicList && !isUserOwnerOrAdmin)) {
              return (
                <div>
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
              <div>
                <EnhancedTaskCreation
                  layoutType={layoutType}
                  selectedListId={selectedListId}
                  availableLists={lists}
                  quickTaskInput={quickTaskInput}
                  setQuickTaskInput={setQuickTaskInput}
                  onCreateTask={handleQuickCreateTask}
                  onKeyDown={handleQuickTaskKeyDown}
                  isMobile={isMobilePhoneDevice()}
                  isSessionReady={isSessionReady}
                  className="w-full"
                />
              </div>
            )
          })()}
        </div>

        {recentlyChangedList && !(isMobile && mobileView === 'list') ? (
          // Show blank task rows during list transitions using expected count
          <div
            className={`overflow-y-auto relative scrollbar-hide task-list-container ${
              isMobile ? 'flex-1 min-h-0 mobile-task-list-container' : 'flex-1'
            }`}
            style={isMobile ? {
              height: 'calc(100% - 80px)', // Account for fixed bottom add task input
              paddingBottom: '1rem' // Additional padding for comfortable scrolling
            } : undefined}
          >
            <div
              className="px-4 py-4"
              style={{
                transform: 'none', // No pull-to-refresh transform during loading
                transition: 'none'
              }}
            >

            </div>
          </div>
        ) : hasProjectBoard && taskViewMode === 'board' ? (
          <div id="task_list_area" className="flex-1 min-h-0">
            <ProjectStatusBoard
              allTasks={allTasks}
              lists={lists}
              selectedListId={selectedListId}
              currentUser={effectiveSession?.user}
              availableTasks={allTasks}
              onUpdateTask={handleUpdateTask}
              onLocalUpdateTask={handleLocalUpdateTask}
              onDeleteTask={handleDeleteTask}
              onCopyTask={handleCopyTask}
              onCreateTask={handleQuickCreateTask}
              isOneColumn={Boolean(isOneColumn)}
              onStatusesChanged={onStatusesChanged}
            />
          </div>
        ) : finalFilteredTasks.length === 0 && !justReturnedFromTaskDetail ? (
          <div id="task_list_area" className="flex-1 flex items-center justify-center px-4">
            {pullToRefresh.isRefreshing && isMobile ? (
              <div className="w-full" />
            ) : (() => {
              // Determine list type for contextual empty state message
              const currentList = lists.find(list => list.id === selectedListId)
              const isPublicList = currentList?.privacy === 'PUBLIC'
              const isSharedList = currentList && getAllListMembers(currentList).length > 1

              let listType: 'personal' | 'shared' | 'today' | 'my-tasks' | 'public' | 'assigned' | 'not-in-list' | 'default' = 'default'

              if (selectedListId === 'today') listType = 'today'
              else if (selectedListId === 'my-tasks') listType = 'my-tasks'
              else if (selectedListId === 'assigned') listType = 'assigned'
              else if (selectedListId === 'not-in-list') listType = 'not-in-list'
              else if (selectedListId === 'public') listType = 'public'
              else if (isPublicList) listType = 'public'
              else if (isSharedList) listType = 'shared'
              else if (currentList) listType = 'personal'

              return (
                <AstridEmptyState
                  listType={listType}
                  listName={currentList?.name}
                  isViewingFromFeatured={isViewingFromFeatured}
                />
              )
            })()}
          </div>
        ) : (
          <div
            className={`overflow-y-auto relative scrollbar-hide task-list-container ${
              isMobile ? 'flex-1 min-h-0 mobile-task-list-container' : 'flex-1'
            }`}
            style={isMobile ? {
              height: 'calc(100% - 80px)', // Account for fixed bottom add task input
              paddingBottom: '1rem' // Additional padding for comfortable scrolling
            } : undefined}
            ref={(el) => {
              // Merge refs: set both scrollContainerRef and pullToRefresh.bindToElement
              scrollContainerRef.current = el
              if (typeof pullToRefresh.bindToElement === 'function') {
                pullToRefresh.bindToElement(el)
              } else if (pullToRefresh.bindToElement) {
                (pullToRefresh.bindToElement as React.MutableRefObject<HTMLDivElement | null>).current = el
              }
            }}
            onTouchStart={pullToRefresh.onTouchStart}
            onTouchMove={pullToRefresh.onTouchMove}
            onTouchEnd={pullToRefresh.onTouchEnd}
            onScroll={() => {
              // Close task detail on scroll ONLY in 2-column and 3-column layouts
              // Don't close in 1-column mobile view, and don't close if scrolling via keyboard navigation
              if (selectedTaskId && !isKeyboardScrollingRef.current && (is2Column || is3Column)) {
                closeTaskDetail()
              }
            }}
          >
            {/* Pull-to-refresh indicator - synced with content transform (both capped at 60px) */}
            {isMobile && (pullToRefresh.isPulling || pullToRefresh.isRefreshing) && (
              <div
                className="absolute left-0 right-0 flex items-center justify-center transition-all duration-200 ease-out z-20"
                style={{
                  top: 0,
                  height: pullToRefresh.isRefreshing ? 60 : Math.min(pullToRefresh.pullDistance, 60),
                }}
              >
                <div className="flex items-center space-x-2 text-gray-500 dark:text-gray-400">
                  {pullToRefresh.isRefreshing ? (
                    <>
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                      <span className="text-sm font-medium">Refreshing...</span>
                    </>
                  ) : pullToRefresh.canRefresh ? (
                    <>
                      <ArrowLeft className="w-5 h-5 transform -rotate-90" />
                      <span className="text-sm font-medium">Release to refresh</span>
                    </>
                  ) : (
                    <>
                      <ArrowLeft className="w-5 h-5 transform rotate-90" />
                      <span className="text-sm font-medium">Pull to refresh</span>
                    </>
                  )}
                </div>
              </div>
            )}

            <div
              className={isMobile ? "px-2 pb-60 pt-2" : "p-4"}
              style={{
                transform: isMobile && pullToRefresh.pullDistance > 0
                  ? `translateY(${Math.min(pullToRefresh.pullDistance, 60)}px)`
                  : undefined,
                transition: pullToRefresh.isPulling ? 'none' : 'transform 0.2s ease-out'
              }}
            >
              <div
                ref={taskListContainerRef}
                className={isMobile ? "space-y-2.5" : "space-y-2.5"}
              >
                {shouldVirtualizeTaskList(finalFilteredTasks.length, manualSortActive) ? (
                  <VirtualizedTaskList
                    tasks={finalFilteredTasks}
                    scrollElementRef={scrollContainerRef}
                    renderRow={renderTaskRow}
                  />
                ) : (
                  finalFilteredTasks.map(renderTaskRow)
                )}
                {manualSortPreviewActive && finalFilteredTasks.length > 0 && (
                  <div
                    className="mt-2 min-h-[24px]"
                    onDragOver={(event) => {
                      if (!manualSortPreviewActive || !activeDragTaskId) return
                      event.preventDefault()
                      handleTaskDragHoverEnd()
                    }}
                    onDrop={(event) => {
                      if (manualSortPreviewActive) {
                        event.preventDefault()
                      }
                    }}
                  >
                    {dragTargetPosition === 'end' && renderManualPlaceholderRow('manual-end-placeholder', undefined, {
                      style: draggingTaskMetrics?.height !== undefined
                        ? { height: `${draggingTaskMetrics.height}px` }
                        : undefined
                    })}
                  </div>
                )}
                {manualSortPreviewActive && finalFilteredTasks.length === 0 && (
                  <div
                    className="mt-2"
                    onDragOver={(event) => {
                      if (!activeDragTaskId) return
                      event.preventDefault()
                      handleTaskDragHoverEnd()
                    }}
                    onDrop={(event) => {
                      if (manualSortPreviewActive) {
                        event.preventDefault()
                      }
                    }}
                  >
                    {renderManualPlaceholderRow('manual-empty-placeholder', 'Drop here to place the first task')}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* List Settings Popover for Current List - Mobile Only */}
      {isMobile && selectedListId && !["my-tasks", "today", "not-in-list", "public", "assigned"].includes(selectedListId) && (
        (() => {
          const currentList = lists.find(list => list.id === selectedListId) || listMetadata
          if (!currentList) return null

          return showSettingsPopover === currentList.id && (
            <ListSettingsPopover
              key={`settings-current-mobile-${currentList.id}`}
              list={currentList}
              currentUser={effectiveSession?.user}
              availableUsers={availableUsers}
              canEditSettings={canEditListSettingsMemo(currentList) && !isViewingFromFeatured}
              open={showSettingsPopover === selectedListId}
              onOpenChange={(open) => setShowSettingsPopover(open ? selectedListId : null)}
              onEditImage={() => handleListImageClick(currentList.id)}
              onLeave={(list, isOwnerLeaving) => handleLeaveList(list, isOwnerLeaving)}
              onUpdate={onListUpdate}
              onFavoriteToggle={onFavoriteToggle}
              onProjectBoardCreated={onProjectBoardCreated}
              onDelete={(listId) => {
                onListDelete(listId)
                setShowSettingsPopover(null)
              }}
            >
              <div />
            </ListSettingsPopover>
          )
        })()
      )}

      {/* Fixed List Settings Popover for System Lists - Mobile Only */}
      {isMobile && ["my-tasks", "today", "not-in-list", "public", "assigned"].includes(selectedListId) && (
        <FixedListSettingsPopover
          key={`fixed-settings-mobile-${selectedListId}`}
          listId={selectedListId}
          listName={getSelectedListInfo().name}
          listDescription={getSelectedListInfo().description}
          currentUser={effectiveSession?.user}
          availableUsers={availableUsers}
          open={showSettingsPopover === selectedListId}
          onOpenChange={(open) => setShowSettingsPopover(open ? selectedListId : null)}
          filterPriority={newFilterState.filters.priority}
          setFilterPriority={newFilterState.setPriority}
          filterAssignee={newFilterState.filters.assignee}
          setFilterAssignee={newFilterState.setAssignee}
          filterDueDate={newFilterState.filters.dueDate}
          setFilterDueDate={newFilterState.setDueDate}
          filterCompletion={newFilterState.filters.completed}
          setFilterCompletion={newFilterState.setCompleted}
          sortBy={newFilterState.filters.sortBy}
          setSortBy={newFilterState.setSortBy}
          hasActiveFilters={newFilterState.hasActiveFilters}
          clearAllFilters={newFilterState.clearAllFilters}
        />
      )}
    </div>

    {/* Description Viewer/Editor Dialog */}
    <DescriptionDialog
      ref={descriptionDialogRef}
      currentList={currentListForDialog}
      canEditSettings={currentListForDialog ? canEditListSettingsMemo(currentListForDialog) : false}
      isViewingFromFeatured={!!isViewingFromFeatured}
      setTempListDescription={setTempListDescription}
      onListUpdate={onListUpdate}
    />
    </>
  )
}
