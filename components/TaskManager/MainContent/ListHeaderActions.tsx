"use client"

/**
 * The desktop list header's controls, and the rule about who may see them.
 *
 * Extracted from MainContent when Sort & Filters gained its own button
 * (task aa4e7eb0) and the file went past its size budget. The oversized-files
 * ratchet asks for the next piece to come out rather than the number to go up,
 * and this is a real seam: self-contained controls with one visibility rule.
 *
 * **Two buttons, because they are two different things.** The funnel is YOUR
 * view of this list — sort and filters are per-user now — and the gear is the
 * list itself, which is shared with everyone who can see it. They used to be
 * one gear opening a modal whose first tab was personal and whose other tabs
 * were not, which is precisely what made people think a filter was theirs when
 * it was not.
 *
 * **Where they sit (AWTD-1167, AWTD-1168), as on Mac:** the gear and the
 * icon-only List/Board toggle beside the list's name; the funnel on its own
 * slim row below "Add a task...", just above the line over the tasks — on the
 * board view too, which used to hide the whole header and with it every way
 * to sort, filter or switch back to the list.
 */

import { Button } from "@/components/ui/button"
import { Filter, Settings } from "lucide-react"
import { canUserManageList } from "@/lib/list-permissions"
import { useTranslations } from "@/lib/i18n/client"
import { TaskViewToggle } from "../Header/TaskViewToggle"

export interface ListControlsVisibility {
  /** The list being viewed, for the public-list visibility rule below. */
  list: { privacy?: string } | null | undefined
  currentUserId?: string | null
  /** Browsing someone else's featured list — read-only, so neither control applies. */
  isViewingFromFeatured?: boolean
}

/**
 * Featured browsing is read-only whoever you are; a public list you do not
 * administer offers neither control to a passer-by.
 */
export function canUseListControls({ list, currentUserId, isViewingFromFeatured }: ListControlsVisibility): boolean {
  if (isViewingFromFeatured) return false
  const isPublicList = list?.privacy === "PUBLIC"
  const isUserOwnerOrAdmin = !!currentUserId && canUserManageList({ id: currentUserId }, list as never)
  return !(isPublicList && !isUserOwnerOrAdmin)
}

// stopPropagation on the handlers: the header row is itself clickable, and
// without it opening a panel also triggers the row.
const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()
const iconButton = "theme-text-muted hover:theme-text-primary h-8 w-8 p-0"

/** The list's own settings — shared with everyone who can see the list. */
export function ListSettingsButton({ onOpen, ...visibility }: ListControlsVisibility & { onOpen: () => void }) {
  const { t } = useTranslations()
  if (!canUseListControls(visibility)) return null
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={(e) => {
        stop(e)
        onOpen()
      }}
      onMouseDown={stop}
      className={iconButton}
      data-settings-button="true"
      aria-label={t('listSettings.adminSettings')}
      title={t('listSettings.adminSettings')}
    >
      <Settings className="w-4 h-4" />
    </Button>
  )
}

/**
 * The slim row under "Add a task...", above the line over the tasks, holding
 * this viewer's Sort & Filters. System lists pass no visibility (always shown).
 */
export function ListFilterRow({ onOpen, ...visibility }: Partial<ListControlsVisibility> & { onOpen: () => void }) {
  const { t } = useTranslations()
  if (visibility.list !== undefined && !canUseListControls(visibility as ListControlsVisibility)) return null
  return (
    <div className="flex justify-end -mb-3 mt-2" data-testid="list-filter-row">
      <Button
        variant="ghost"
        size="sm"
        onClick={(e) => {
          stop(e)
          onOpen()
        }}
        onMouseDown={stop}
        className={iconButton}
        data-sort-filters-button="true"
        aria-label={t('listSettings.sortAndFilters')}
        title={t('listSettings.sortAndFilters')}
      >
        <Filter className="w-4 h-4" />
      </Button>
    </div>
  )
}

/** List / Board, icons only — always, not just below a width (AWTD-1167). */
export function ListViewToggle(props: {
  hasProjectBoard: boolean
  taskViewMode: 'list' | 'board'
  onTaskViewModeChange?: (mode: 'list' | 'board') => void
  isSearching: boolean
}) {
  if (!props.hasProjectBoard) return null
  return (
    <TaskViewToggle
      labelClassName="sr-only"
      compact
      isOneColumn={false}
      hasProjectBoard
      chatAvailable={false}
      activeView="list"
      isSearching={props.isSearching}
      activePanel="tasks"
      taskViewMode={props.taskViewMode}
      onTaskViewModeChange={props.onTaskViewModeChange}
      onToggleActivePanel={undefined}
    />
  )
}
