"use client"

import { BRAND } from '@/lib/brand/config'
import React, { useRef } from "react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Plus, ExternalLink, Settings, Search } from "lucide-react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { useTranslations } from "@/lib/i18n/client"
import { ListItem } from "./ListItem"
import { isListAdminOrOwner } from "@/lib/list-member-utils"
import { canUserEditTasks } from "@/lib/list-permissions"
import { isDomainList } from "@/lib/list-flavors"
import type { TaskList } from "@/types/task"

interface LeftSidebarProps {
  // Layout and responsive
  isMobile: boolean
  showHamburgerMenu: boolean
  showMobileSidebar: boolean
  sidebarRef: React.MutableRefObject<HTMLDivElement | null>

  // Data
  effectiveSession: any
  lists: TaskList[]
  publicLists: TaskList[]
  collaborativePublicLists: TaskList[]
  suggestedPublicLists: TaskList[]
  selectedListId: string

  // Memoized functions
  getFixedListTaskCountMemo: (listType: string) => number
  getSavedFilterTaskCountMemo: (list: TaskList) => number
  getTaskCountForListMemo: (listId: string) => number

  // Handlers
  setSelectedListId: (listId: string, fromFeatured?: boolean) => void
  setShowMobileSidebar: (show: boolean) => void
  setShowAddListModal: (show: boolean) => void
  setShowPublicBrowser: (show: boolean) => void
  setShowSettingsPopover?: (listId: string | null) => void
  onNavigateSettings?: (page: string) => void
  onLogoClick?: () => void
  activeView?: 'list' | 'settings' | 'search'
  onSelectSearch?: () => void

  // Swipe handlers (optional for backward compatibility)
  sidebarSwipeToDismiss?: {
    onTouchStart: (e: React.TouchEvent) => void
    onTouchMove: (e: React.TouchEvent) => void
    onTouchEnd: () => void
  }

  // Drag and drop state
  isTaskDragActive: boolean
  dragOverListId: string | null
  isShiftDrag: boolean
  onTaskDropOnList: (listId: string, options: { shiftKey: boolean }) => void
  onTaskDragEnter: (listId: string, shiftKey: boolean) => void
  onTaskDragLeave: (listId: string) => void
  onTaskDragOver: (shiftKey: boolean, listId: string) => void
}

export function LeftSidebar({
  isMobile,
  showHamburgerMenu,
  showMobileSidebar,
  sidebarRef,
  effectiveSession,
  lists,
  publicLists,
  collaborativePublicLists,
  suggestedPublicLists,
  selectedListId,
  getFixedListTaskCountMemo,
  getSavedFilterTaskCountMemo,
  getTaskCountForListMemo,
  setSelectedListId,
  setShowMobileSidebar,
  setShowAddListModal,
  setShowPublicBrowser,
  setShowSettingsPopover,
  onNavigateSettings,
  onLogoClick,
  activeView = 'list',
  onSelectSearch,
  sidebarSwipeToDismiss,
  isTaskDragActive,
  dragOverListId,
  isShiftDrag,
  onTaskDropOnList,
  onTaskDragEnter,
  onTaskDragLeave,
  onTaskDragOver
}: LeftSidebarProps) {
  const router = useRouter()
  const { t } = useTranslations()
  const navigationRef = useRef<HTMLDivElement>(null)
  const currentUser = effectiveSession?.user
  // When not in list view, don't highlight any list
  const effectiveSelectedListId = activeView === 'list' ? selectedListId : ''

  const handleListClick = (listId: string, fromFeatured?: boolean) => {
    // Always update state immediately for smooth UX
    setSelectedListId(listId, fromFeatured)

    // Scroll sidebar navigation to top on mobile
    if (navigationRef.current) {
      navigationRef.current.scrollTo({
        top: 0,
        behavior: 'smooth'
      })
    }

    // Update URL without navigation for real lists
    if (listId !== "my-tasks") {
      // Use replace to update URL without adding to history stack for rapid clicking
      window.history.replaceState(null, '', `/lists/${listId}`)
    } else {
      // For my-tasks, go back to home URL
      window.history.replaceState(null, '', '/')
    }

    if (showHamburgerMenu) {
      setShowMobileSidebar(false)
    }
  }

  const handleAddListClick = () => {
    setShowAddListModal(true)
    if (showHamburgerMenu) {
      setShowMobileSidebar(false)
    }
  }

  const handleSettingsClick = () => {
    if (onNavigateSettings) {
      onNavigateSettings('hub')
    } else {
      router.push('/settings')
    }
    if (showHamburgerMenu) {
      setShowMobileSidebar(false)
    }
  }

  const handleSearchClick = () => {
    onSelectSearch?.()
    if (showHamburgerMenu) {
      setShowMobileSidebar(false)
    }
  }

  const canDropOnList = (list: TaskList) => {
    if (!isTaskDragActive) return false
    if (!currentUser) return false
    if (list.isVirtual) return false
    return canUserEditTasks(currentUser, list)
  }

  return (
    <div
      ref={sidebarRef}
      className={`theme-sidebar theme-border overflow-hidden flex flex-col ${
        showHamburgerMenu
          ? `app-sidebar-mobile ${showMobileSidebar ? 'app-sidebar-mobile-open' : ''}`
          : 'app-sidebar'
      }`}
      {...(sidebarSwipeToDismiss && {
        onTouchStart: sidebarSwipeToDismiss.onTouchStart,
        onTouchMove: sidebarSwipeToDismiss.onTouchMove,
        onTouchEnd: sidebarSwipeToDismiss.onTouchEnd,
      })}
    >
      {/* Scrollable Navigation */}
      <div ref={navigationRef} className="flex-1 min-h-0 overflow-y-auto scrollbar-hide sidebar-navigation">
        {/* Astrid brand header */}
        <div className="px-3 pt-3">
          <div
            className="flex items-center space-x-2 cursor-pointer hover:opacity-80 transition-opacity"
            title="Go to Home"
            onClick={onLogoClick}
          >
            <Image
              src={BRAND.iconSmall}
              alt={BRAND.appName}
              width={28}
              height={28}
              className="rounded-sm"
            />
            <span className="text-lg font-semibold tracking-tight theme-text-primary">{BRAND.wordmark}</span>
          </div>
        </div>

        <div className="p-3">
          <div className="space-y-1">
            {/* Search */}
            <Button
              variant="ghost"
              className={`w-full justify-start ${
                isMobile ? 'mobile-list-item text-left' : ''
              } ${
                activeView === 'search'
                  ? "bg-blue-600 !text-white hover:bg-blue-700 hover:!text-white"
                  : "theme-text-secondary hover:theme-text-primary hover:theme-bg-hover"
              }`}
              onClick={handleSearchClick}
            >
              <div className="flex items-center w-full">
                <Search className="w-4 h-4 mr-2" />
                <span>{t("search.placeholder") || "Search"}</span>
              </div>
            </Button>

            {/* My Tasks */}
            <Button
              variant="ghost"
              className={`w-full justify-start ${
                isMobile ? 'mobile-list-item text-left' : ''
              } ${
                activeView === 'list' && selectedListId === "my-tasks"
                  ? "bg-blue-600 !text-white hover:bg-blue-700 hover:!text-white"
                  : "theme-text-secondary hover:theme-text-primary hover:theme-bg-hover"
              }`}
              onClick={() => handleListClick("my-tasks")}
            >
              <div className="flex items-center justify-between w-full">
                <span>{t("navigation.myTasks")}</span>
                <span className="text-xs theme-count-bg theme-text-primary px-2 py-1 rounded">
                  {getFixedListTaskCountMemo("my-tasks")}
                </span>
              </div>
            </Button>

            {/* Saved Filters */}
            {lists
              .filter(list => list.isFavorite)
              .filter((list, index, self) => {
                // Deduplicate lists by ID (keep first occurrence)
                return self.findIndex(l => l.id === list.id) === index
              })
              .sort((a, b) => (a.favoriteOrder || 0) - (b.favoriteOrder || 0))
              .map((list) => (
                <ListItem
                  key={list.id}
                  list={list}
                  selectedListId={effectiveSelectedListId}
                  isMobile={isMobile}
                  taskCount={list.isVirtual ? getSavedFilterTaskCountMemo(list) : getTaskCountForListMemo(list.id)}
                  onClick={handleListClick}
                  onSettingsClick={setShowSettingsPopover || undefined}
                  droppable={canDropOnList(list)}
                  isDragActive={isTaskDragActive}
                  isDropTarget={dragOverListId === list.id}
                  dropMode={isShiftDrag ? 'add' : 'move'}
                  onTaskDrop={(shiftKey) => onTaskDropOnList(list.id, { shiftKey })}
                  onTaskDragEnter={(shiftKey) => onTaskDragEnter(list.id, shiftKey)}
                  onTaskDragLeave={() => onTaskDragLeave(list.id)}
                  onTaskDragOver={onTaskDragOver}
                />
              ))}
          </div>
        </div>

        {/* Lists */}
        <div className="p-3 mt-4">
          <div className="text-[0.6875rem] font-medium opacity-50 tracking-wide mb-2 px-2">
            {t("navigation.lists")}
          </div>
          <div className="space-y-1">
            <Button
              variant="ghost"
              className="w-full justify-start theme-text-secondary hover:theme-text-primary hover:theme-bg-hover"
              onClick={handleAddListClick}
            >
              <Plus className="w-4 h-4 mr-2" />
              {t("navigation.addList")}
            </Button>

            {/* Lists */}
            {lists
              .filter(list => !list.isFavorite)
              // Labels and board columns are not destinations — they render as
              // chips and columns respectively (task 60f5849d).
              .filter(isDomainList)
              .filter(list => {
                // Exclude public lists that the user doesn't own or admin
                if (list.privacy === 'PUBLIC') {
                  return effectiveSession?.user?.id ?
                    isListAdminOrOwner(list, effectiveSession.user.id) : false
                }
                return true
              })
              .filter((list, index, self) => {
                // Deduplicate lists by ID (keep first occurrence)
                return self.findIndex(l => l.id === list.id) === index
              })
              .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
              .map((list) => (
                <ListItem
                  key={list.id}
                  list={list}
                  selectedListId={effectiveSelectedListId}
                  isMobile={isMobile}
                  taskCount={list.isVirtual ? getSavedFilterTaskCountMemo(list) : getTaskCountForListMemo(list.id)}
                  onClick={handleListClick}
                  onSettingsClick={setShowSettingsPopover || undefined}
                  droppable={canDropOnList(list)}
                  isDragActive={isTaskDragActive}
                  isDropTarget={dragOverListId === list.id}
                  dropMode={isShiftDrag ? 'add' : 'move'}
                  onTaskDrop={(shiftKey) => onTaskDropOnList(list.id, { shiftKey })}
                  onTaskDragEnter={(shiftKey) => onTaskDragEnter(list.id, shiftKey)}
                  onTaskDragLeave={() => onTaskDragLeave(list.id)}
                  onTaskDragOver={onTaskDragOver}
                />
              ))}
          </div>
        </div>

        {/* Public Shared Lists */}
        {collaborativePublicLists && collaborativePublicLists.length > 0 && (
          <div className="p-3 mt-4">
            <div className="text-[0.6875rem] font-medium opacity-50 tracking-wide mb-2 px-2">
              {t("navigation.publicSharedLists")}
            </div>
            <div className="space-y-1">
              {/* Show max 2 collaborative lists that user doesn't already own/admin */}
              {collaborativePublicLists
                .filter(list => {
                  // Exclude public lists that user owns/admins (they already appear in "Lists" section)
                  if (effectiveSession?.user?.id) {
                    return !isListAdminOrOwner(list, effectiveSession.user.id)
                  }
                  return true
                })
                .slice(0, 2).map((list) => (
                <ListItem
                  key={list.id}
                  list={list}
                  selectedListId={effectiveSelectedListId}
                  isMobile={isMobile}
                  taskCount={(list as any)._count?.tasks || 0}
                  onClick={(listId) => handleListClick(listId, true)}
                  onSettingsClick={setShowSettingsPopover || undefined}
                />
              ))}
            </div>

            {/* See all collaborative lists link */}
            {collaborativePublicLists.length > 2 && (
              <button
                onClick={() => setShowPublicBrowser(true)}
                className="w-full mt-2 px-4 py-2 text-sm text-[rgb(var(--theme-accent))] hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors text-left"
              >
                {t("navigation.seeAllCollaborative")}
              </button>
            )}
          </div>
        )}

        {/* Public Lists */}
        {suggestedPublicLists && suggestedPublicLists.length > 0 && (
          <div className="p-3 mt-4">
            <div className="text-[0.6875rem] font-medium opacity-50 tracking-wide mb-2 px-2">
              {t("navigation.publicLists")}
            </div>
            <div className="space-y-1">
              {/* Show max 2 suggested lists that user doesn't already own/admin */}
              {suggestedPublicLists
                .filter(list => {
                  // Exclude public lists that user owns/admins (they already appear in "Lists" section)
                  if (effectiveSession?.user?.id) {
                    return !isListAdminOrOwner(list, effectiveSession.user.id)
                  }
                  return true
                })
                .slice(0, 2).map((list) => (
                <ListItem
                  key={list.id}
                  list={list}
                  selectedListId={effectiveSelectedListId}
                  isMobile={isMobile}
                  taskCount={(list as any)._count?.tasks || 0}
                  onClick={(listId) => handleListClick(listId, true)}
                  onSettingsClick={setShowSettingsPopover || undefined}
                />
              ))}
            </div>

            {/* See all suggested lists link */}
            {suggestedPublicLists.length > 2 && (
              <button
                onClick={() => setShowPublicBrowser(true)}
                className="w-full mt-2 px-4 py-2 text-sm text-[rgb(var(--theme-accent))] hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors text-left"
              >
                {t("navigation.seeAllSuggested")}
              </button>
            )}

            <div className="pb-16"></div>
          </div>
        )}
      </div>

      {/* Fixed Footer — Settings with user avatar */}
      <div className="border-t border-[rgb(var(--theme-border))] flex-shrink-0">
        <Button
          variant="ghost"
          onClick={handleSettingsClick}
          className={`w-full p-3 h-auto justify-start ${
            activeView === 'settings'
              ? "bg-blue-600 !text-white hover:bg-blue-700 hover:!text-white"
              : "theme-text-secondary hover:theme-text-primary hover:theme-bg-hover"
          }`}
        >
          <div className="flex items-center space-x-3 w-full">
            <Avatar className="w-7 h-7 rounded-lg flex-shrink-0">
              <AvatarImage src={effectiveSession.user.image || "/placeholder.svg"} />
              <AvatarFallback className="text-xs">{effectiveSession.user.name?.charAt(0) || "U"}</AvatarFallback>
            </Avatar>
            <span className="truncate text-sm font-medium flex-1 text-left">{effectiveSession.user.name}</span>
            <Settings className="w-4 h-4 flex-shrink-0 opacity-60" />
          </div>
        </Button>
      </div>
    </div>
  )
}
