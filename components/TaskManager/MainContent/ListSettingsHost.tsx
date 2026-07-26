"use client"

/**
 * Single mount point for the list-settings popover (Reuse Phase 3, task ecf56cd3).
 *
 * MainContent previously carried four near-identical blocks: desktop/mobile ×
 * custom-list/system-list. The desktop and mobile pairs were byte-identical
 * apart from their React `key`, so ~20 props were repeated four times and any
 * change had to be made in all four places.
 *
 * This owns the one real decision — system lists get FixedListSettingsPopover,
 * user lists get ListSettingsPopover — so callers just place it. The `variant`
 * only distinguishes the React keys of the two mount positions, which are kept
 * because desktop and mobile render in different parts of the tree.
 */

import { ListSettingsPopover } from "../../list-settings-popover"
import { FixedListSettingsPopover } from "../../fixed-list-settings-popover"

/** Lists Astrid provides itself; they get the fixed (filter-only) popover. */
export const SYSTEM_LIST_IDS = ["my-tasks", "today", "not-in-list", "public", "assigned"] as const

export function isSystemList(listId: string): boolean {
  return (SYSTEM_LIST_IDS as readonly string[]).includes(listId)
}

type DueDateFilter = "overdue" | "today" | "tomorrow" | "this_week" | "this_month" | "this_calendar_week" | "this_calendar_month" | "no_date" | "all"
type CompletionFilter = "completed" | "incomplete" | "all" | "default"
type SortBy = "auto" | "priority" | "when" | "assignee" | "completed" | "incomplete" | "manual"

/** Mirrors the filter slice FixedListSettingsPopover consumes. */
interface FilterState {
  filters: {
    priority: number[]
    assignee: string[]
    dueDate: DueDateFilter
    completed: CompletionFilter
    sortBy: SortBy
  }
  setPriority: (priority: number[]) => void
  setAssignee: (assignee: string[]) => void
  setDueDate: (dueDate: DueDateFilter) => void
  setCompleted: (completion: CompletionFilter) => void
  setSortBy: (sort: SortBy) => void
  hasActiveFilters: boolean
  clearAllFilters: () => void
}

export interface ListSettingsHostProps {
  /** Distinguishes the desktop and mobile mount points' React keys. */
  variant: "desktop" | "mobile"
  selectedListId: string
  lists: Array<{ id: string }>
  listMetadata?: { id: string } | null
  currentUser: unknown
  availableUsers: unknown
  /** Open when this equals the list id. */
  showSettingsPopover: string | null
  setShowSettingsPopover: (listId: string | null) => void
  canEditListSettings: (list: never) => boolean
  isViewingFromFeatured?: boolean
  selectedListInfo: { name: string; description?: string }
  filterState: FilterState
  statuses: unknown
  onEditImage: (listId: string) => void
  onLeave: (list: never, isOwnerLeaving: boolean) => void
  onListUpdate: unknown
  onFavoriteToggle: unknown
  onProjectBoardCreated: unknown
  onProjectBoardRemoved: unknown
  onStatusesChanged: unknown
  onListDelete: (listId: string) => void
}

export function ListSettingsHost(props: ListSettingsHostProps) {
  const {
    variant, selectedListId, lists, listMetadata, currentUser, availableUsers,
    showSettingsPopover, setShowSettingsPopover, canEditListSettings,
    isViewingFromFeatured, selectedListInfo, filterState, statuses,
    onEditImage, onLeave, onListUpdate, onFavoriteToggle, onProjectBoardCreated,
    onProjectBoardRemoved, onStatusesChanged, onListDelete,
  } = props

  const keySuffix = variant === "mobile" ? "-mobile" : ""

  if (isSystemList(selectedListId)) {
    return (
      <FixedListSettingsPopover
        key={`fixed-settings${keySuffix}-${selectedListId}`}
        listId={selectedListId}
        listName={selectedListInfo.name}
        listDescription={selectedListInfo.description ?? ""}
        currentUser={currentUser as never}
        availableUsers={availableUsers as never}
        open={showSettingsPopover === selectedListId}
        onOpenChange={(open: boolean) => setShowSettingsPopover(open ? selectedListId : null)}
        filterPriority={filterState.filters.priority}
        setFilterPriority={filterState.setPriority}
        filterAssignee={filterState.filters.assignee}
        setFilterAssignee={filterState.setAssignee}
        filterDueDate={filterState.filters.dueDate}
        setFilterDueDate={filterState.setDueDate}
        filterCompletion={filterState.filters.completed}
        setFilterCompletion={filterState.setCompleted}
        sortBy={filterState.filters.sortBy}
        setSortBy={filterState.setSortBy}
        hasActiveFilters={filterState.hasActiveFilters}
        clearAllFilters={filterState.clearAllFilters}
      />
    )
  }

  if (!selectedListId) return null

  const currentList = lists.find(list => list.id === selectedListId) || listMetadata
  if (!currentList) return null
  if (showSettingsPopover !== currentList.id) return null

  return (
    <ListSettingsPopover
      key={`settings-current${keySuffix}-${currentList.id}`}
      list={currentList as never}
      currentUser={currentUser as never}
      availableUsers={availableUsers as never}
      canEditSettings={canEditListSettings(currentList as never) && !isViewingFromFeatured}
      open={showSettingsPopover === selectedListId}
      onOpenChange={(open: boolean) => setShowSettingsPopover(open ? selectedListId : null)}
      onEditImage={() => onEditImage(currentList.id)}
      onLeave={onLeave as never}
      onUpdate={onListUpdate as never}
      onFavoriteToggle={onFavoriteToggle as never}
      onProjectBoardCreated={onProjectBoardCreated as never}
      onProjectBoardRemoved={onProjectBoardRemoved as never}
      statuses={statuses as never}
      onStatusesChanged={onStatusesChanged as never}
      onDelete={(listId: string) => {
        onListDelete(listId)
        setShowSettingsPopover(null)
      }}
    >
      <div />
    </ListSettingsPopover>
  )
}
