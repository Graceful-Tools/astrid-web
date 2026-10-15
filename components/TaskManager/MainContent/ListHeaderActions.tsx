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
 * This viewer's Sort & Filters, sitting ON the line between "Add a task..." and
 * the tasks (AWTD-1204): out of flow, straddling the border, and lined up with
 * the checkbox of the row below.
 *
 * **Absolutely positioned, so its parent must be `relative`** — it is placed
 * against the bordered header block in MainContent, and against the viewport if
 * it is ever rendered somewhere unpositioned.
 *
 * `left-[29px]` is the checkbox's own left edge, and the three terms are worth
 * writing down because no single class expresses them: 16px from the rows
 * wrapper's `p-4`, plus 1px for the task card's border, plus 12px from
 * `.task-row`'s `px-3`. Measured, not guessed; the button and the checkbox are
 * both 32px wide, so aligning their left edges aligns their centres too.
 *
 * `-bottom-4` centres the 32px control on the border: half its height below the
 * padding box's bottom edge. That is the border's inner edge, so the control
 * sits half a pixel above the 1px line's true centre — not expressible in
 * Tailwind's scale, and not visible.
 *
 * `theme-bg-primary` is the pane's own background, and it is load-bearing: the
 * border runs the full width behind this control, so without it the line is
 * drawn straight through the middle of the icon. It masks exactly the control's
 * 32px box, which reads as the line making way for the button.
 *
 * System lists pass no visibility (always shown).
 */
export function ListFilterRow({ onOpen, ...visibility }: Partial<ListControlsVisibility> & { onOpen: () => void }) {
  const { t } = useTranslations()
  if (visibility.list !== undefined && !canUseListControls(visibility as ListControlsVisibility)) return null
  return (
    <div className="absolute left-[29px] -bottom-4 z-10 theme-bg-primary" data-testid="list-filter-row">
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
