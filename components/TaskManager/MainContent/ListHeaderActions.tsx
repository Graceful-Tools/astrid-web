"use client"

/**
 * The two buttons in a user list's header, and the rule about who may see them.
 *
 * Extracted from MainContent when Sort & Filters gained its own button
 * (task aa4e7eb0) and the file went past its size budget. The oversized-files
 * ratchet asks for the next piece to come out rather than the number to go up,
 * and this is a real seam: a self-contained control with one visibility rule.
 *
 * **Two buttons, because they are two different things.** The funnel is YOUR
 * view of this list — sort and filters are per-user now — and the gear is the
 * list itself, which is shared with everyone who can see it. They used to be
 * one gear opening a modal whose first tab was personal and whose other tabs
 * were not, which is precisely what made people think a filter was theirs when
 * it was not.
 *
 * The funnel also matches what system lists have always shown for this panel:
 * FixedListSettingsPopover is reached from a Filter icon, not a gear.
 */

import { Button } from "@/components/ui/button"
import { Filter, Settings } from "lucide-react"
import { canUserManageList } from "@/lib/list-permissions"
import { useTranslations } from "@/lib/i18n/client"

export interface ListHeaderActionsProps {
  listId: string
  /** The list being viewed, for the public-list visibility rule below. */
  list: { privacy?: string } | null | undefined
  currentUserId?: string | null
  /** Browsing someone else's featured list — read-only, so neither control applies. */
  isViewingFromFeatured?: boolean
  onOpenSortFilters: (listId: string) => void
  onOpenSettings: (listId: string) => void
}

export function ListHeaderActions({
  listId,
  list,
  currentUserId,
  isViewingFromFeatured,
  onOpenSortFilters,
  onOpenSettings,
}: ListHeaderActionsProps) {
  const { t } = useTranslations()

  const isPublicList = list?.privacy === "PUBLIC"
  const isUserOwnerOrAdmin =
    !!currentUserId && canUserManageList({ id: currentUserId }, list as never)

  // Featured browsing is read-only whoever you are; a public list you do not
  // administer offers neither control to a passer-by.
  if (isViewingFromFeatured || (isPublicList && !isUserOwnerOrAdmin)) {
    return null
  }

  // stopPropagation on both handlers: the header row is itself clickable, and
  // without it opening either panel also triggers the row.
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={(e) => {
          e.stopPropagation()
          onOpenSortFilters(listId)
        }}
        onMouseDown={(e) => e.stopPropagation()}
        className="theme-text-muted hover:theme-text-primary p-2"
        data-sort-filters-button="true"
        aria-label={t('listSettings.sortAndFilters')}
        title={t('listSettings.sortAndFilters')}
      >
        <Filter className="w-5 h-5" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={(e) => {
          e.stopPropagation()
          onOpenSettings(listId)
        }}
        onMouseDown={(e) => e.stopPropagation()}
        className="theme-text-muted hover:theme-text-primary p-2"
        data-settings-button="true"
      >
        <Settings className="w-5 h-5" />
      </Button>
    </>
  )
}
