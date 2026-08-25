"use client"

import React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Search, Menu, Settings, Filter } from "lucide-react"
import { ChatToggle } from "@/components/chat/ChatToggle"
import { NotificationBell } from "@/components/notification-bell"
import { useTranslations } from "@/lib/i18n/client"
import { useMyTasksPreferences } from "@/hooks/useMyTasksPreferences"
import { getMyTasksFilterText, getPriorityColorClass } from "@/lib/task-manager-utils"
import { getMobileHeaderMode } from "@/lib/mobile-header-mode"
import { getHeaderViewToggle } from "@/lib/header-view-toggle"
import { TaskViewToggle } from "./TaskViewToggle"
import type { Task, TaskList } from "@/types/task"
import { hasExplicitListRole } from "@/lib/list-permissions"

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
  hasProjectBoard?: boolean
  taskViewMode?: 'list' | 'board'
  onTaskViewModeChange?: (mode: 'list' | 'board') => void

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
  hasProjectBoard = false,
  taskViewMode = 'list',
  onTaskViewModeChange,
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
    // Owner, admin or member — this had re-implemented getUserRoleInList inline
    // (ownerId, owner relation, listMembers admin, legacy admins[], member).
    // The helper covers all of those and also matches listMembers by userId, not
    // only the loaded user relation (task e2803305).
    return hasExplicitListRole({ id: effectiveSession.user.id }, selectedList as never)
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

  /*
   * Publish the floating header's real bottom edge, so the content below can
   * clear it (task 8c090700).
   *
   * `.app-header-mobile-floating` is `position: fixed` and takes no space in
   * flow, so without an offset the first task renders underneath it. The offset
   * is measured rather than hardcoded because the header's height depends on
   * what is in it — a hardcoded value silently goes wrong the next time a
   * control is added, and "the first row is slightly under the header" is
   * exactly the kind of drift nobody files twice.
   */
  const headerRef = React.useRef<HTMLDivElement | null>(null)
  const isFloating = Boolean(isMobile && showHamburgerMenu)

  React.useEffect(() => {
    const node = headerRef.current
    if (!isFloating || !node || typeof window === 'undefined') {
      // Not floating: the header is in flow and takes its own space, so any
      // published offset must be withdrawn or the content sits too low.
      document.documentElement.style.removeProperty('--mobile-floating-header-height')
      return
    }

    const publish = () => {
      // bottom, not height: it includes the 8px margin and any safe-area inset,
      // which is what the content actually has to clear.
      const bottom = node.getBoundingClientRect().bottom
      document.documentElement.style.setProperty(
        '--mobile-floating-header-height',
        `${Math.round(bottom)}px`,
      )
    }

    publish()

    // Guarded: ResizeObserver is absent in jsdom and in older browsers, and a
    // missing API must not take the header down with it. Without the observer
    // the offset is still published once, which is correct until the header
    // changes size.
    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(publish) : null
    observer?.observe(node)
    window.addEventListener('orientationchange', publish)

    return () => {
      observer?.disconnect()
      window.removeEventListener('orientationchange', publish)
      document.documentElement.style.removeProperty('--mobile-floating-header-height')
    }
  }, [isFloating])

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

  // See lib/mobile-header-mode.ts for the rules. The header is identical
  // across mobile list / task / chat panes (bug 35c1ad50). Back navigation
  // happens via swipe-right / the in-pane close, not via a header swap.
  const mobileHeaderMode = getMobileHeaderMode({
    isMobile,
    showHamburgerMenu,
    mobileView,
    isMobileTaskDetailClosing: Boolean(isMobileTaskDetailClosing),
  })
  const showListHeader = mobileHeaderMode !== 'desktop'

  // Build the unified header view-toggle config. In 1-col mode this becomes
  // a single segmented control (List / Board / Messages); on wider screens
  // it's the legacy List/Board toggle with a separate ChatToggle icon.
  const headerToggle = getHeaderViewToggle({
    isOneColumn: isMobile,
    hasProjectBoard,
    chatAvailable: Boolean(onToggleActivePanel),
    activeView,
    isSearching: Boolean(mobileSearchMode || (searchValue || '').trim()),
  })

  // Shared props for the reusable List/Board(/Messages) toggle so the
  // hamburger header renders exactly what it used to.
  const taskViewToggleProps = {
    isOneColumn: isMobile,
    hasProjectBoard,
    chatAvailable: Boolean(onToggleActivePanel),
    activeView,
    isSearching: Boolean(mobileSearchMode || (searchValue || '').trim()),
    activePanel,
    taskViewMode,
    onTaskViewModeChange,
    onToggleActivePanel,
  }

  // Desktop / 3-column: the header is empty (logo moved to the sidebar, the
  // view toggle moved into MainContent's list-header row). Render nothing so
  // there's no empty bar/border.
  if (!showListHeader) {
    return null
  }

  return (
    <div ref={headerRef} className={headerClasses}>
      {(
        // Mobile/Narrow Desktop List View: Unified flex layout with hamburger menu
        <div className="flex items-center justify-between w-full max-w-full min-h-[44px]">
          {/* Left: Hamburger button with large tap target, aligned with task checkboxes.
              The hamburger stays put across mobile list / task / chat panes. */}
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

          {/* Right: Chat toggle + Settings icon (context-dependent). When the
              unified toggle is active it already contains Messages — don't
              render a duplicate ChatToggle icon. */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <TaskViewToggle {...taskViewToggleProps} />

            <NotificationBell />

            {!headerToggle.unified && onToggleActivePanel && activeView === 'list' && !(mobileSearchMode || searchValue.trim()) && (
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
      )}
    </div>
  )
}
