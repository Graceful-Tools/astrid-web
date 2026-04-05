"use client"

import React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Search, Menu, ArrowLeft, Settings, Filter, X, Keyboard } from "lucide-react"
import { ChatToggle } from "@/components/chat/ChatToggle"
import Image from "next/image"
import { useTranslations } from "@/lib/i18n/client"
import { useMyTasksPreferences } from "@/hooks/useMyTasksPreferences"
import { getMyTasksFilterText, getPriorityColorClass } from "@/lib/task-manager-utils"
import type { Task, TaskList } from "@/types/task"

interface TaskManagerHeaderProps {
  // Layout and responsive
  isMobile: boolean
  showHamburgerMenu: boolean
  mobileView: 'list' | 'task' | 'chat'
  isMobileTaskDetailClosing?: boolean

  // Data
  lists: TaskList[]
  selectedListId: string
  selectedTask: Task | null
  effectiveSession: any

  // Search and filter state
  mobileSearchMode: boolean
  searchValue: string

  // My Tasks filter preferences (optional, only needed for my-tasks list)
  myTasksFilterPriority?: number[]
  myTasksFilterDueDate?: string

  // Handlers
  toggleMobileSidebar: () => void
  handleMobileBack: () => void
  onLogoClick: () => void
  handleMobileSearchStart: () => void
  handleMobileSearchEnd: () => void
  handleMobileSearchClear: () => void
  handleMobileSearchKeyDown: (e: React.KeyboardEvent) => void
  onSearchChange: (value: string) => void
  setShowSettingsPopover: (listId: string) => void
  onShowKeyboardShortcuts: () => void
  isTaskDragActive?: boolean
  onHamburgerDragHover?: () => void

  // Chat toggle
  activePanel?: 'tasks' | 'chat'
  onToggleActivePanel?: (panel: 'tasks' | 'chat') => void
}

export function TaskManagerHeader({
  isMobile,
  showHamburgerMenu,
  mobileView,
  isMobileTaskDetailClosing,
  lists,
  selectedListId,
  selectedTask,
  effectiveSession,
  mobileSearchMode,
  searchValue,
  myTasksFilterPriority,
  myTasksFilterDueDate,
  toggleMobileSidebar,
  handleMobileBack,
  onLogoClick,
  handleMobileSearchStart,
  handleMobileSearchEnd,
  handleMobileSearchClear,
  handleMobileSearchKeyDown,
  onSearchChange,
  setShowSettingsPopover,
  onShowKeyboardShortcuts,
  isTaskDragActive = false,
  onHamburgerDragHover,
  activePanel = 'tasks',
  onToggleActivePanel
}: TaskManagerHeaderProps) {
  const { t } = useTranslations()
  const { filters } = useMyTasksPreferences()

  // Check if user can access settings for the selected list
  const selectedList = lists.find(list => list.id === selectedListId)
  const canAccessSettings = (() => {
    // Fixed lists always have filter access (my-tasks, today, etc.)
    if (["my-tasks", "today", "not-in-list", "public", "assigned"].includes(selectedListId)) {
      return true
    }
    // For regular lists, check if user is owner or admin
    if (!selectedList || !effectiveSession?.user?.id) {
      return false
    }
    const userId = effectiveSession.user.id
    // Owner check
    if (selectedList.ownerId === userId || selectedList.owner?.id === userId) {
      return true
    }
    // Admin check via listMembers
    if (selectedList.listMembers?.some(m => m.user?.id === userId && m.role === "admin")) {
      return true
    }
    // Admin check via admins array (legacy)
    if (selectedList.admins?.some(a => a.id === userId)) {
      return true
    }
    // Member check - members need access to view membership and leave
    if (selectedList.listMembers?.some(m => m.user?.id === userId)) {
      return true
    }
    return false
  })()

  // Effective filter values: use props if provided (for testing), otherwise use hook
  const effectivePriority = myTasksFilterPriority ?? filters.priority
  const effectiveDueDate = myTasksFilterDueDate ?? filters.dueDate

  // Get filter text for My Tasks
  const getListNameWithFilters = () => {
    let baseName = ''
    if (selectedListId === "my-tasks") {
      baseName = t("listHeaders.myTasks")
    } else if (selectedListId) {
      baseName = lists.find(list => list.id === selectedListId)?.name || ""
    } else {
      return "astrid"
    }

    // Only add filter indicators for My Tasks
    if (selectedListId === "my-tasks") {
      const filterText = getMyTasksFilterText({
        filterDueDate: effectiveDueDate,
        filterPriority: effectivePriority
      })

      if (filterText) {
        return `${baseName} - ${filterText}`
      }
    }

    return baseName
  }

  // Render list name with colored priority indicators (including priority 0 ○)
  const renderListNameWithColors = () => {
    const fullText = getListNameWithFilters()

    // Only apply colors if we're on My Tasks and have priority filters
    if (selectedListId === "my-tasks" && effectivePriority && effectivePriority.length > 0) {
      const filterText = getMyTasksFilterText({
        filterDueDate: effectiveDueDate,
        filterPriority: effectivePriority
      })

      // If there's filter text with priority indicators (including ○ for priority 0)
      if (filterText && (filterText.includes('!') || filterText.includes('○'))) {
        // Split by priority marks (!!!, !!, !, ○) - order matters for regex
        const parts = fullText.split(/(!!!|!!|!|○)/)

        return (
          <span className="text-lg font-semibold truncate inline-block max-w-full">
            {parts.map((part, index) => {
              // Check if this part is priority marks
              if (part === '!!!') {
                return <span key={index} className={getPriorityColorClass(3)}>{part}</span>
              } else if (part === '!!') {
                return <span key={index} className={getPriorityColorClass(2)}>{part}</span>
              } else if (part === '!') {
                return <span key={index} className={getPriorityColorClass(1)}>{part}</span>
              } else if (part === '○') {
                return <span key={index} className="text-gray-400">{part}</span>
              }
              return <span key={index}>{part}</span>
            })}
          </span>
        )
      }
    }

    // Default rendering without colors
    return (
      <span className="text-lg font-semibold truncate inline-block max-w-full">
        {fullText}
      </span>
    )
  }

  // Build header classes - add floating style on mobile
  const headerClasses = [
    "app-header theme-header relative overflow-hidden",
    isMobile && showHamburgerMenu ? "app-header-mobile-floating" : "theme-border"
  ].filter(Boolean).join(" ")

  return (
    <div className={headerClasses}>
      {showHamburgerMenu && mobileView === 'list' ? (
        // Mobile/Narrow Desktop List View: Unified flex layout with hamburger menu
        <div className="flex items-center justify-between w-full max-w-full min-h-[44px]">
          {/* Left: Hamburger button with large tap target, aligned with task checkboxes */}
          <div className="flex-shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleMobileSidebar}
              className="pl-1.5 pr-1 py-3 min-w-[44px] min-h-[44px]"
              data-hamburger-button
              onDragEnter={(event) => {
                if (!isTaskDragActive) return
                event.preventDefault()
                onHamburgerDragHover?.()
              }}
              onDragOver={(event) => {
                if (!isTaskDragActive) return
                event.preventDefault()
                onHamburgerDragHover?.()
              }}
              onDrop={(event) => {
                if (isTaskDragActive) {
                  event.preventDefault()
                }
              }}
            >
              <Menu className="w-5 h-5" />
            </Button>
          </div>

          {/* Center: List name or Search input - vertically centered */}
          <div className="flex-1 min-w-0 overflow-hidden flex items-center">
            {(mobileSearchMode || searchValue.trim()) ? (
              // Search mode: Full search input
              <div className="relative w-full">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 theme-text-muted" />
                <Input
                  placeholder={t("search.placeholder")}
                  value={searchValue}
                  onChange={(e) => onSearchChange(e.target.value)}
                  onKeyDown={handleMobileSearchKeyDown}
                  onBlur={() => {
                    // Only close search mode if there's no search query
                    if (!searchValue.trim()) {
                      handleMobileSearchEnd()
                    }
                  }}
                  className="theme-input theme-text-primary pl-10 pr-10 w-full"
                  autoComplete="off"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleMobileSearchClear}
                  className="absolute right-1 top-1/2 transform -translate-y-1/2 p-1"
                  aria-label="Clear search"
                  data-testid="search-clear-button"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              // Normal mode: Show list name (left aligned, vertically centered)
              <div className="flex items-center justify-start overflow-hidden w-full h-full">
                {renderListNameWithColors()}
              </div>
            )}
          </div>

          {/* Right: Chat toggle + Search icon + Settings icon (always visible) */}
          <div className="flex items-center gap-1 flex-shrink-0">
            {onToggleActivePanel && !(mobileSearchMode || searchValue.trim()) && (
              <ChatToggle
                activePanel={activePanel}
                onToggle={onToggleActivePanel}
              />
            )}

            {!(mobileSearchMode || searchValue.trim()) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleMobileSearchStart}
                className="p-2"
              >
                <Search className="w-5 h-5" />
              </Button>
            )}

            {selectedListId && canAccessSettings && (
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation()
                  setShowSettingsPopover(selectedListId)
                }}
                onMouseDown={(e) => {
                  // Prevent outside click handler from closing task panel
                  e.stopPropagation()
                }}
                className="p-2"
                data-settings-button="true"
              >
                {["my-tasks", "today", "not-in-list", "public", "assigned"].includes(selectedListId) ? (
                  <Filter className="w-5 h-5" />
                ) : (
                  <Settings className="w-5 h-5" />
                )}
              </Button>
            )}
          </div>
        </div>
      ) : isMobile && mobileView === 'task' && !isMobileTaskDetailClosing ? (
        // Mobile Task View (hidden during close animation)
        <div className="flex items-center justify-between gap-2 w-full max-w-full">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleMobileBack}
            className="p-2 flex-shrink-0"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>

          {selectedTask && (
            <div className="flex-1 text-center min-w-0 overflow-hidden px-2">
              <span className="text-lg font-medium truncate inline-block max-w-full">{selectedTask.title}</span>
            </div>
          )}

          <div className="flex-shrink-0 w-10" /> {/* Spacer for centering */}
        </div>
      ) : (
        // Desktop View
        <div className="flex items-center space-x-4">
          <div
            className="flex items-center space-x-2 cursor-pointer hover:opacity-80 transition-opacity"
            onClick={onLogoClick}
            title="Go to Home"
          >
            <Image
              src="/icons/icon-96x96.png"
              alt="Astrid"
              width={36}
              height={36}
              className="rounded"
            />
            <span className="text-xl font-bold theme-text-primary">astrid</span>
          </div>

          {/* Desktop Search Bar */}
          <div className="absolute left-80 top-1/2 transform -translate-y-1/2 ml-10 max-w-xl">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 theme-text-muted" />
              <Input
                placeholder={t("search.placeholder")}
                value={searchValue}
                onChange={(e) => onSearchChange(e.target.value)}
                className="theme-input theme-text-primary pl-10 h-9 w-full"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
