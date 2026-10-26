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
 *
 * Since task aa4e7eb0 it also hosts ListSortAndFiltersPopover, which is a
 * SEPARATE control from List Settings rather than a tab inside it: sort and
 * filters are per-user now, and everything left in List Settings is shared by
 * everyone who can see the list. The two open independently, so the host can
 * render either, both or neither. System lists are unaffected — their popover
 * has only ever been a filter panel.
 */

import { ListSettingsPopover } from "../../list-settings-popover"
import { FixedListSettingsPopover } from "../../fixed-list-settings-popover"
import { ListSortAndFiltersPopover } from "../../list-sort-and-filters-popover"

// Lists Astrid provides itself get the fixed (filter-only) popover. The id set
// is owned by lib/list-permissions (task e2803305) — do not re-spell it here.
export { SYSTEM_LIST_IDS, isSystemListId as isSystemList } from "@/lib/list-permissions"
import { isSystemListId } from "@/lib/list-permissions"

type DueDateFilter = "overdue" | "today" | "tomorrow" | "this_week" | "this_month" | "this_calendar_week" | "this_calendar_month" | "no_date" | "all"
type CompletionFilter = "completed" | "incomplete" | "all" | "default"
type SortBy = "auto" | "priority" | "when" | "assignee" | "completed" | "incomplete" | "completedAt" | "manual"

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
  /**
   * Sort & Filters, which is a SEPARATE control from List Settings now that it
   * is per-user state rather than the list's own (task aa4e7eb0). Two open
   * flags rather than one tab index, because they are two different things
   * owned by two different people — you, and everyone.
   *
   * System lists need neither: FixedListSettingsPopover has only ever been a
   * filter panel, so for those the settings flag already means this.
   */
  showSortFiltersPopover?: string | null
  setShowSortFiltersPopover?: (listId: string | null) => void
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
    showSettingsPopover, setShowSettingsPopover,
    showSortFiltersPopover, setShowSortFiltersPopover, canEditListSettings,
    isViewingFromFeatured, selectedListInfo, filterState, statuses,
    onEditImage, onLeave, onListUpdate, onFavoriteToggle, onProjectBoardCreated,
    onProjectBoardRemoved, onStatusesChanged, onListDelete,
  } = props

  const keySuffix = variant === "mobile" ? "-mobile" : ""

  if (isSystemListId(selectedListId)) {
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

  const settingsOpen = showSettingsPopover === currentList.id
  const sortFiltersOpen = showSortFiltersPopover === currentList.id
  if (!settingsOpen && !sortFiltersOpen) return null

  return (
    <>
      {sortFiltersOpen && (
        <ListSortAndFiltersPopover
          key={`sort-filters${keySuffix}-${currentList.id}`}
          list={currentList as never}
          currentUser={currentUser as never}
          open
          onOpenChange={(open: boolean) =>
            setShowSortFiltersPopover?.(open ? currentList.id : null)}
          onUpdate={onListUpdate as never}
          onFavoriteToggle={onFavoriteToggle as never}
          canEditSettings={canEditListSettings(currentList as never) && !isViewingFromFeatured}
        />
      )}
      {settingsOpen && (
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
      )}
    </>
  )
}
