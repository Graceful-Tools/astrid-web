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

  // Unified navigation
  activeView?: 'list' | 'settings' | 'search'
  settingsPage?: string | null
  isSearchActive?: boolean
  onExitSettings?: () => void
  onNavigateSettings?: (page: string) => void
  onExitSearch?: () => void
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
  onToggleActivePanel,
  activeView = 'list',
  settingsPage,
  isSearchActive = false,
  onExitSettings,
  onNavigateSettings,
  onExitSearch
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
          <span className="text-base font-medium tracking-tight truncate inline-block max-w-full">
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
      <span className="text-base font-medium tracking-tight truncate inline-block max-w-full">
        {fullText}
      </span>
    )
  }

  // Build header classes - add floating style on mobile
  const headerClasses = [
    "app-header theme-header relative overflow-hidden",
    isMobile && showHamburgerMenu ? "app-header-mobile-floating" : "theme-border"
  ].filter(Boolean).join(" ")

  // Settings page title mapping for breadcrumb
  const settingsSubPageTitle: Record<string, string> = {
    'account': t("settingsPages.accountAccess.title"),
    'appearance': t("settingsPages.appearance.title"),
    'reminders': t("settingsPages.remindersNotifications.title"),
    'agents': t("settingsPages.aiAgents.title"),
    'api-access': t("settingsPages.apiAccess.title"),
    'contacts': t("settingsPages.contacts.title"),
    'debug': t("settingsPages.debug.title"),
    'coding-integration': 'Coding Integration',
    'coding-agents': 'Cloud Agents',
    'tasks': 'Task Settings',
    'api-testing': 'API Testing',
    'agents/github-setup': 'GitHub Setup',
    'help': 'Help & Support',
    'privacy': 'Privacy Policy',
    'terms': 'Terms of Service',
  }

  // Render settings breadcrumb title
  const renderSettingsTitle = () => {
    if (!settingsPage || settingsPage === 'hub') {
      return <span className="text-base font-medium tracking-tight truncate">{t("settings.settings")}</span>
    }
    const subTitle = settingsSubPageTitle[settingsPage] || settingsPage
    return (
      <span className="text-base font-medium tracking-tight truncate">
        <button
          onClick={() => onNavigateSettings?.('hub')}
          className="hover:underline opacity-70"
        >
          {t("settings.settings")}
        </button>
        <span className="mx-1.5 opacity-40">/</span>
        {subTitle}
      </span>
    )
  }

  // During the close-animation window, mobileView is still 'task' but
  // isMobileTaskDetailClosing is true. Without this guard the task branch is
  // suppressed (waiting for the animation to finish) and the list branch hasn't
  // taken over yet — control falls through to the desktop Astrid-logo branch
  // and you see a flash of the wordmark before the list header reappears.
  // Treat the closing state as "already on the list" for header purposes.
  const isHeadingBackToList = isMobile && isMobileTaskDetailClosing
  const showListHeader = (showHamburgerMenu && mobileView === 'list') || isHeadingBackToList

  return (
    <div className={headerClasses}>
      {showListHeader ? (
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

          {/* Center: List name, Settings title, or Search input */}
          <div className="flex-1 min-w-0 overflow-hidden flex items-center">
            {activeView === 'settings' ? (
              // Settings mode: Show "Settings" title
              <div className="flex items-center justify-start overflow-hidden w-full h-full">
                <span className="text-base font-medium tracking-tight truncate">{t("settings.settings")}</span>
              </div>
            ) : isSearchActive ? (
              // Search mode: search input in header for mobile, title for desktop
              showHamburgerMenu ? (
                <div className="relative w-full">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 theme-text-muted" />
                  <Input
                    placeholder={t("search.placeholder") || "Search"}
                    value={searchValue}
                    onChange={(e) => onSearchChange(e.target.value)}
                    className="theme-input theme-text-primary pl-10 w-full"
                    autoComplete="off"
                    autoFocus
                  />
                </div>
              ) : (
                <div className="flex items-center justify-start overflow-hidden w-full h-full">
                  <span className="text-base font-medium tracking-tight truncate">{t("search.placeholder") || "Search"}</span>
                </div>
              )
            ) : (
              // Normal mode: Show list name
              <div className="flex items-center justify-start overflow-hidden w-full h-full">
                {renderListNameWithColors()}
              </div>
            )}
          </div>

          {/* Right: Chat toggle + Settings icon (context-dependent) */}
          <div className="flex items-center gap-1 flex-shrink-0">
            {onToggleActivePanel && activeView === 'list' && !(mobileSearchMode || searchValue.trim()) && (
              <ChatToggle
                activePanel={activePanel}
                onToggle={onToggleActivePanel}
              />
            )}

            {activeView === 'list' && selectedListId && canAccessSettings && (
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
              width={28}
              height={28}
              className="rounded-sm"
            />
            <span className="text-lg font-semibold tracking-tight theme-text-primary">astrid</span>
          </div>

        </div>
      )}
    </div>
  )
}
