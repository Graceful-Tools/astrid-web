"use client"

import React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ListSettingsPopover } from "../../list-settings-popover"
import { FixedListSettingsPopover } from "../../fixed-list-settings-popover"
import { QuickTaskCreate } from "../../quick-task-create"
import { EnhancedTaskCreation, useLayoutType } from "../../enhanced-task-creation"
import { isMobilePhoneDevice } from "@/lib/layout-detection"
import { TaskCheckbox } from "../../task-checkbox"
import { PublicTaskCopyButton } from "../../public-task-copy-button"
import { AstridEmptyState } from "@/components/ui/astrid-empty-state"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Settings,
  Filter,
  Check,
  X,
  ArrowLeft,
  Globe,
  Users,
  Copy,
  Hash,
  Eye,
  Edit3,
  FileText,
  Bot
} from "lucide-react"
import { isPublicListTask, shouldHideTaskWhen } from "@/lib/public-list-utils"
import { format } from "date-fns"
import { renderMarkdown } from "@/lib/markdown"
import { formatDateForDisplay } from "@/lib/date-utils"
import { getListImageUrl, getConsistentDefaultImage } from "@/lib/default-images"
import { getAllListMembers } from "@/lib/list-member-utils"
import type { Task, TaskList } from "@/types/task"

interface MainContentProps {
  // Layout and responsive props
  isMobile: boolean
  mobileView: 'list' | 'task'
  isMobileTaskDetailClosing?: boolean
  is2Column?: boolean
  is3Column?: boolean

  // Data props
  selectedListId: string
  lists: TaskList[]
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
  handleToggleTaskComplete: (taskId: string) => Promise<void>
  handleQuickCreateTask: (title: string, options?: { priority?: number; assigneeId?: string | null; navigateToDetail?: boolean }) => Promise<string | null>
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
  onListDelete: (listId: string) => void
}

export function MainContent({
  isMobile,
  mobileView,
  isMobileTaskDetailClosing,
  is2Column,
  is3Column,
  selectedListId,
  lists,
  finalFilteredTasks,
  listMetadata,
  effectiveSession,
  availableUsers,
  isViewingFromFeatured,
  newFilterState,
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
  handleToggleTaskComplete,
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
  onListDelete
}: MainContentProps) {
  // Detect current layout type for enhanced task creation
  const layoutType = useLayoutType()

  // Description viewer/editor dialog state
  const [showDescriptionDialog, setShowDescriptionDialog] = React.useState(false)
  const [descriptionDialogMode, setDescriptionDialogMode] = React.useState<'view' | 'edit'>('view')
  const [dialogDescription, setDialogDescription] = React.useState('')

  const [draggingTaskMetrics, setDraggingTaskMetrics] = React.useState<{ taskId: string; height: number } | null>(null)
  const taskMeasurementsRef = React.useRef<Map<string, number>>(new Map())
  const [mobileDragState, setMobileDragState] = React.useState<{ taskId: string } | null>(null)
  const mobileDragTouchIdRef = React.useRef<number | null>(null)
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
      setMobileDragState(null)
      mobileDragTouchIdRef.current = null
    }
  }, [activeDragTaskId])

  React.useEffect(() => {
    if ((!manualSortActive || !isTouchManualSort) && mobileDragState) {
      setMobileDragState(null)
      mobileDragTouchIdRef.current = null
    }
  }, [manualSortActive, isTouchManualSort, mobileDragState])

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

  React.useEffect(() => {
    if (!isTouchManualSort || !manualSortActive || !mobileDragState) {
      return
    }

    const findTrackedTouch = (touches: TouchList): Touch | null => {
      if (mobileDragTouchIdRef.current === null) {
        return touches.length > 0 ? touches[0] : null
      }
      for (let i = 0; i < touches.length; i += 1) {
        const current = touches.item(i)
        if (current && current.identifier === mobileDragTouchIdRef.current) {
          return current
        }
      }
      return null
    }

    const handleTouchMove = (event: TouchEvent) => {
      const touch = findTrackedTouch(event.touches)
      if (!touch) {
        return
      }
      event.preventDefault()

      const targetElement = document.elementFromPoint(touch.clientX, touch.clientY) as HTMLElement | null
      if (targetElement) {
        const taskElement = targetElement.closest<HTMLElement>("[data-task-id]")
        if (taskElement) {
          const hoveredTaskId = taskElement.getAttribute("data-task-id")
          if (!hoveredTaskId || hoveredTaskId === activeDragTaskId) {
            return
          }
          const rect = taskElement.getBoundingClientRect()
          const offsetY = touch.clientY - rect.top
          const ratio = rect.height > 0 ? offsetY / rect.height : 0
          let position: 'above' | 'below' | null = null
          if (ratio <= 0.35) {
            position = 'above'
          } else if (ratio >= 0.65) {
            position = 'below'
          }
          if (position) {
            handleTaskDragHover(hoveredTaskId, position)
          }
          return
        }
      }

      const listContainer = taskListContainerRef.current
      if (listContainer) {
        const listRect = listContainer.getBoundingClientRect()
        if (touch.clientY > listRect.bottom) {
          handleTaskDragHoverEnd()
        }
      }
    }

    const handleTouchEnd = (event: TouchEvent) => {
      const touch = findTrackedTouch(event.changedTouches)
      if (!touch) {
        return
      }
      event.preventDefault()
      setMobileDragState(null)
      mobileDragTouchIdRef.current = null
      handleTaskDragEnd()
      setDraggingTaskMetrics(null)
    }

    document.addEventListener("touchmove", handleTouchMove, { passive: false })
    document.addEventListener("touchend", handleTouchEnd, { passive: false })
    document.addEventListener("touchcancel", handleTouchEnd, { passive: false })

    return () => {
      document.removeEventListener("touchmove", handleTouchMove)
      document.removeEventListener("touchend", handleTouchEnd)
      document.removeEventListener("touchcancel", handleTouchEnd)
    }
  }, [
    isTouchManualSort,
    manualSortActive,
    mobileDragState,
    activeDragTaskId,
    handleTaskDragHover,
    handleTaskDragHoverEnd,
    handleTaskDragEnd
  ])

  // Calculate parallax state for mobile transitions
  const isShowingTaskDetail = isMobile && mobileView === 'task' && !isMobileTaskDetailClosing

  // Get the current list for dialog context
  const currentListForDialog = lists.find(l => l.id === selectedListId)

  return (
    <>
    <div className={`flex-1 min-w-0 ${isMobile ? 'relative' : 'flex'}`}>
      {/* Task List Area */}
      <div
        ref={taskManagerRef}
        className={`theme-bg-primary flex flex-col relative z-10 ${
        isMobile
          ? 'absolute inset-x-0 bottom-0 transition-all duration-300 ease-in-out'
          : 'w-[450px] flex-shrink-0 flex-grow-0'
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
        <div className="p-6 theme-border border-b" style={{ display: isMobile ? 'none' : 'block' }}>
          {/* Centered List Header with Image and Editable Name */}
          <div className="text-center mb-6">
            {selectedListId && !["my-tasks", "today", "not-in-list", "public", "assigned"].includes(selectedListId) && (
              (() => {
                const currentList = lists.find(list => list.id === selectedListId) || listMetadata
                if (!currentList) return null

                return (
                  <div className="flex items-center justify-start space-x-4 mb-4 px-4">
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
                    <div className="text-left flex-1 max-w-md">
                      {editingListName ? (
                        <div className="flex items-center justify-start space-x-2">
                          <Input
                            value={tempListName}
                            onChange={(e) => setTempListName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveListName()
                              if (e.key === "Escape") setEditingListName(false)
                            }}
                            className="theme-input theme-text-primary text-3xl font-bold text-left max-w-md"
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
                        <h1 className={`text-3xl font-bold theme-text-primary mb-1 text-left ${!newFilterState.filters.search.trim() && canEditListSettingsMemo(currentList) && !isViewingFromFeatured ? 'cursor-pointer hover:theme-text-secondary' : ''}`}
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
                              setDialogDescription(currentList.description)
                              setDescriptionDialogMode('view')
                              setShowDescriptionDialog(true)
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
              <div className="flex items-center justify-start space-x-4 mb-4 px-4">
                <div className="text-left flex-1 max-w-md">
                  <h1 className="text-3xl font-bold theme-text-primary mb-1">{getSelectedListInfo().name}</h1>
                  <p className="theme-text-muted text-sm">{getSelectedListInfo().description}</p>
                </div>
                <div className="flex items-center space-x-2">
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


          {/* Enhanced Task Input - Desktop only (mobile version is fixed at bottom) */}
          {!isMobile && (() => {
            const selectedList = lists.find(list => list.id === selectedListId)
            const isPublicList = selectedList?.privacy === 'PUBLIC'
            const isCollaborative = selectedList?.publicListType === 'collaborative'
            const isUserOwnerOrAdmin = selectedList?.ownerId === effectiveSession?.user?.id ||
                                      selectedList?.admins?.some(admin => admin.id === effectiveSession?.user?.id)

            // For collaborative lists, always show task creation (even when viewing from featured)
            if (isCollaborative || isUserOwnerOrAdmin) {
              return (
                <div className="px-4">
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
                <div className="px-4">
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
              <div className="px-4">
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
                className={isMobile ? "space-y-2" : "space-y-2"}
              >
                {finalFilteredTasks.map((task) => {
                  const isDragging = activeDragTaskId === task.id
                  // Unified card styling for both mobile and desktop
                  const classNames = [
                    'task-row task-card transition-theme relative theme-surface theme-border',
                    task.completed
                      ? 'task-row-completed theme-bg-hover'
                      : selectedTaskId === task.id
                        ? 'task-row-selected theme-bg-selected'
                        : 'theme-surface-hover'
                  ]
                  if (isMobile) {
                    classNames.push('mobile-task-item')
                    if (!isTouchManualSort) {
                      classNames.push('cursor-grab')
                    }
                  } else {
                    classNames.push('cursor-grab')
                  }

                  if (isDragging) {
                    classNames.push('opacity-60 ring-2 ring-blue-400/40')
                  }

                  const rowRef = registerTaskRow(task.id)
                  const measuredHeight = taskMeasurementsRef.current.get(task.id) ?? null
                  const dropGap = isTouchManualSort ? 0 : 8
                  const dropOverlayPosition =
                    manualSortPreviewActive && dragTargetTaskId === task.id ? dragTargetPosition : null
                  const movingTaskHeight =
                    typeof draggingTaskMetrics?.height === 'number'
                      ? draggingTaskMetrics.height
                      : activeDragTaskId
                        ? taskMeasurementsRef.current.get(activeDragTaskId) ?? undefined
                        : undefined

                  const overlayHeight =
                    typeof movingTaskHeight === 'number'
                      ? movingTaskHeight
                      : measuredHeight ?? undefined

                  const overlayTopOffset =
                    dropOverlayPosition === 'above'
                      ? overlayHeight !== undefined
                        ? -(overlayHeight + dropGap)
                        : undefined
                      : dropOverlayPosition === 'below'
                        ? (measuredHeight ?? overlayHeight) !== undefined
                          ? (measuredHeight ?? overlayHeight)! + dropGap
                          : undefined
                        : undefined

                  const dropOverlayStyle: React.CSSProperties = {}
                  if (overlayHeight !== undefined) {
                    dropOverlayStyle.height = `${overlayHeight}px`
                  }
                  if (overlayTopOffset !== undefined) {
                    dropOverlayStyle.top = `${overlayTopOffset}px`
                  }

                  const shouldRenderDropOverlay =
                    dropOverlayPosition === 'above' || dropOverlayPosition === 'below'

                  const originPlaceholderStyle: React.CSSProperties = {}
                  const originHeight =
                    typeof draggingTaskMetrics?.height === 'number' && draggingTaskMetrics.taskId === task.id
                      ? draggingTaskMetrics.height
                      : measuredHeight ?? undefined
                  if (originHeight !== undefined) {
                    originPlaceholderStyle.height = `${originHeight}px`
                  }

                  const rowHeight =
                    measuredHeight ??
                    (draggingTaskMetrics?.taskId === task.id ? draggingTaskMetrics.height : undefined)
                  const mobileGrabberStyle: React.CSSProperties = {
                    width: "20%"
                  }
                  if (rowHeight !== undefined) {
                    mobileGrabberStyle.height = `${Math.max(rowHeight / 2, 24)}px`
                  }

                  return (
                    <div key={task.id} className="relative">
                      {shouldRenderDropOverlay &&
                        renderManualPlaceholderRow(`${task.id}-drop-overlay`, undefined, {
                          className: "absolute left-0 right-0 z-20",
                          style: dropOverlayStyle
                        })}
                      {manualSortPreviewActive && isDragging &&
                        renderManualPlaceholderRow(`${task.id}-origin-placeholder`, undefined, {
                          className: "absolute left-0 right-0 top-0 z-10",
                          style: originPlaceholderStyle
                        })}
                      <div
                        ref={rowRef}
                        data-task-id={task.id}
                        className={classNames.join(' ')}
                        onClick={(e) => handleTaskClick(task.id, e.currentTarget as HTMLElement)}
                        draggable={!isTouchManualSort}
                        onDragStart={(event) => {
                          if (isTouchManualSort) return
                          const rect = event.currentTarget.getBoundingClientRect()
                          setDraggingTaskMetrics({ taskId: task.id, height: rect.height })
                          taskMeasurementsRef.current.set(task.id, rect.height)
                          handleTaskDragStart(task.id)
                          if (event.dataTransfer) {
                            event.dataTransfer.effectAllowed = 'move'
                            event.dataTransfer.setData('text/plain', task.id)
                          }
                        }}
                        onDragOver={(event) => {
                          if (!manualSortPreviewActive || !activeDragTaskId || activeDragTaskId === task.id) {
                            return
                          }
                          event.preventDefault()
                          const rect = event.currentTarget.getBoundingClientRect()
                          const offsetY = event.clientY - rect.top
                          const ratio = rect.height > 0 ? offsetY / rect.height : 0
                          let position: 'above' | 'below' | null = null
                          if (ratio <= 0.35) {
                            position = 'above'
                          } else if (ratio >= 0.65) {
                            position = 'below'
                          }
                          if (!position) {
                            return
                          }
                          handleTaskDragHover(task.id, position)
                        }}
                        onDragLeave={(event) => {
                          if (!manualSortPreviewActive) return
                          const related = event.relatedTarget as HTMLElement | null
                          if (related && event.currentTarget.contains(related)) {
                            return
                          }
                          handleTaskDragLeaveTask(task.id)
                        }}
                        onDrop={(event) => {
                          if (manualSortPreviewActive) {
                            event.preventDefault()
                          }
                        }}
                        onDragEnd={() => {
                          handleTaskDragEnd()
                          setDraggingTaskMetrics(null)
                        }}
                        style={manualSortPreviewActive && isDragging ? { opacity: 0 } : undefined}
                      >
                        {manualSortPreviewActive && dragTargetTaskId === task.id && !isTouchManualSort && (
                          <div className="pointer-events-none absolute -top-12 left-1/2 z-[1600] flex w-max -translate-x-1/2 items-center gap-2 rounded-full border border-blue-400/60 bg-blue-900/95 px-3 py-1.5 text-xs font-medium text-blue-50 shadow-2xl backdrop-blur">
                            <span className="inline-flex h-2 w-2 rounded-full bg-emerald-300" />
                            <span>Drag to move • Hold Shift to add without removing</span>
                          </div>
                        )}
                      {isPublicListTask(task) ? (
                      // Show copy button for public list tasks
                      <PublicTaskCopyButton
                        onCopy={() => handleCopyTask(task.id)}
                      />
                    ) : task.assigneeId && task.assigneeId !== effectiveSession?.user?.id ? (
                      // Show profile photo for tasks assigned to others (non-clickable)
                      <div className="relative p-2 -m-2 flex items-center justify-center self-center">
                        <Avatar
                          className="w-8 h-8 rounded-lg border-2"
                          style={{
                            borderColor: getPriorityColor(task.priority)
                          }}
                        >
                          <AvatarImage src={task.assignee?.image || undefined} />
                          <AvatarFallback className="text-xs bg-gray-300 text-gray-700 rounded-lg">
                            {task.assignee?.name?.slice(0, 2) || task.assignee?.email?.slice(0, 2) || '?'}
                          </AvatarFallback>
                        </Avatar>
                      </div>
                    ) : !task.assigneeId ? (
                      // Unassigned tasks: show "U" when incomplete, TaskCheckbox when complete
                      task.completed ? (
                        <TaskCheckbox
                          checked={true}
                          onToggle={() => handleToggleTaskComplete(task.id)}
                          priority={task.priority}
                          repeating={task.repeating !== 'never'}
                        />
                      ) : (
                        <div
                          className="relative p-2 -m-2 cursor-pointer flex items-center justify-center self-center"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleToggleTaskComplete(task.id)
                          }}
                        >
                          <div
                            className="w-8 h-8 rounded-lg border-2 flex items-center justify-center"
                            style={{ borderColor: getPriorityColor(task.priority) }}
                          >
                            <span
                              className="text-sm font-medium"
                              style={{ color: getPriorityColor(task.priority) }}
                            >
                              U
                            </span>
                          </div>
                        </div>
                      )
                    ) : (
                      // Show checkbox for tasks assigned to current user
                      <TaskCheckbox
                        checked={task.completed}
                        onToggle={() => handleToggleTaskComplete(task.id)}
                        priority={task.priority}
                        repeating={task.repeating !== 'never'}
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className={`task-title ${
                        isMobile ? 'text-base font-medium leading-tight' : ''
                      } ${
                        task.completed
                          ? "task-title-completed theme-text-muted"
                          : selectedTaskId === task.id
                            ? "theme-text-selected"
                            : "theme-text-primary"
                      }`}>
                        {task.title}
                      </div>

                      {/* Show due date and lists in a row - date first (left), then lists */}
                      {((task.dueDateTime && !shouldHideTaskWhen(task)) || (task.lists && task.lists.length > 0)) && (
                        <div className="flex items-center mt-1 gap-2">
                          {task.dueDateTime && !shouldHideTaskWhen(task) && (
                            <div className="text-xs theme-text-muted flex-shrink-0">
                              {formatDateForDisplay(new Date(task.dueDateTime), task.isAllDay)}
                              {!task.isAllDay && ` ${format(new Date(task.dueDateTime), "h:mm a")}`}
                            </div>
                          )}
                          <div className="flex flex-wrap gap-1 min-w-0 flex-1">
                            {task.lists && task.lists.length > 0 && (
                              <>
                                {task.lists.filter(list => list != null).slice(0, isMobile ? 2 : undefined).map((list) => (
                                  <div
                                    key={list.id}
                                    className="flex items-center space-x-1 theme-bg-secondary rounded-full px-2 py-0.5 text-xs theme-border border"
                                  >
                                    {(() => {
                                      const privacy = list?.privacy

                                      // Check if list is PUBLIC first
                                      if (privacy === 'PUBLIC') {
                                        return <Globe className="w-3 h-3 text-green-500" />
                                      }

                                      // Check if list is SHARED (has more than just the owner) using consolidated utility
                                      const allMembers = getAllListMembers(list)
                                      const hasAdditionalMembers = allMembers.length > 1 // More than just the owner
                                      if (hasAdditionalMembers) {
                                        return <Users className="w-3 h-3 text-blue-500" />
                                      }

                                      // Default to private - show colored hashtag
                                      return (
                                        <Hash
                                          className={`w-3 h-3 ${isMobile ? 'flex-shrink-0' : ''}`}
                                          style={{ color: list.color }}
                                        />
                                      )
                                    })()}
                                    <span className={`theme-text-secondary ${isMobile ? 'truncate' : ''}`}>{list.name}</span>
                                  </div>
                                ))}
                                {isMobile && task.lists && task.lists.length > 2 && (
                                  <span className="text-xs theme-text-muted">+{task.lists.length - 2}</span>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                    {isTouchManualSort && manualSortActive && (
                      <div
                        className="absolute bottom-0.5 left-1/2 z-30 flex -translate-x-1/2 items-end justify-center"
                        style={mobileGrabberStyle}
                        onTouchStart={(event) => {
                          const touch = event.touches[0]
                          if (!touch || !manualSortActive) {
                            return
                          }
                          const rowNode = event.currentTarget.closest("[data-task-id]") as HTMLDivElement | null
                          const rect = rowNode?.getBoundingClientRect()
                          const height =
                            rect?.height ??
                            taskMeasurementsRef.current.get(task.id) ??
                            draggingTaskMetrics?.height ??
                            undefined
                          if (height) {
                            setDraggingTaskMetrics({ taskId: task.id, height })
                            taskMeasurementsRef.current.set(task.id, height)
                          }
                          mobileDragTouchIdRef.current = touch.identifier
                          setMobileDragState({ taskId: task.id })
                          handleTaskDragStart(task.id)
                          event.stopPropagation()
                          event.preventDefault()
                        }}
                      >
                        <div className="mb-0.5 h-[2px] w-10 rounded-full bg-muted-foreground/70" />
                      </div>
                    )}
                      </div>
                    </div>
                  )
                })}
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
    <Dialog open={showDescriptionDialog} onOpenChange={(open) => {
      if (!open) {
        setShowDescriptionDialog(false)
        setDescriptionDialogMode('view')
      }
    }}>
      <DialogContent className="theme-bg-primary theme-border sm:max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="theme-text-primary flex items-center space-x-2">
            <FileText className="w-5 h-5" />
            <span>Agent Instructions</span>
            {currentListForDialog && (
              <span className="text-sm font-normal theme-text-muted">— {currentListForDialog.name}</span>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* Mode toggle */}
        {currentListForDialog && canEditListSettingsMemo(currentListForDialog) && !isViewingFromFeatured && (
          <div className="flex items-center space-x-1">
            <button
              type="button"
              onClick={() => setDescriptionDialogMode('view')}
              className={`text-xs px-2.5 py-1 rounded ${descriptionDialogMode === 'view' ? 'bg-blue-600 text-white' : 'theme-text-muted hover:theme-bg-hover'}`}
            >
              <Eye className="w-3 h-3 inline mr-1" />
              View
            </button>
            <button
              type="button"
              onClick={() => {
                setDescriptionDialogMode('edit')
                setDialogDescription(currentListForDialog.description || '')
              }}
              className={`text-xs px-2.5 py-1 rounded ${descriptionDialogMode === 'edit' ? 'bg-blue-600 text-white' : 'theme-text-muted hover:theme-bg-hover'}`}
            >
              <Edit3 className="w-3 h-3 inline mr-1" />
              Edit
            </button>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {descriptionDialogMode === 'view' ? (
            <div
              className="prose prose-sm max-w-none theme-text-primary p-1"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(dialogDescription || '*No instructions yet*') }}
            />
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-end">
                <span className="text-xs theme-text-muted">{dialogDescription.length} chars</span>
              </div>
              <textarea
                value={dialogDescription}
                onChange={(e) => setDialogDescription(e.target.value)}
                placeholder={"Write instructions for AI agents working in this list...\n\nSupports markdown: **bold**, *italic*, ## headings, - lists, [links](url)"}
                className="w-full theme-comment-bg theme-border border theme-text-primary rounded-lg px-3 py-2 resize-vertical focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm min-h-[200px]"
                rows={12}
                autoFocus
              />
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-1 text-xs theme-text-muted">
                  <Bot className="w-3 h-3" />
                  <span>Agents receive this as their primary context. Supports markdown.</span>
                </div>
                <div className="flex items-center space-x-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setDescriptionDialogMode('view')}
                    className="text-xs theme-border theme-text-secondary hover:theme-bg-hover"
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={async () => {
                      // Save via the existing handler
                      setTempListDescription(dialogDescription)
                      // Directly call the save
                      if (currentListForDialog && dialogDescription !== (currentListForDialog.description || '')) {
                        try {
                          const response = await fetch(`/api/lists/${currentListForDialog.id}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              ...currentListForDialog,
                              description: dialogDescription.trim() || undefined
                            }),
                          })
                          if (response.ok) {
                            const updatedList = await response.json()
                            onListUpdate(updatedList)
                          }
                        } catch (error) {
                          console.error('Error updating description:', error)
                        }
                      }
                      setDescriptionDialogMode('view')
                    }}
                    className="text-xs bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    <Check className="w-3 h-3 mr-1" />
                    Save
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
    </>
  )
}
