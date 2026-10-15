"use client"

/**
 * The way into Sort & Filters from List Settings, on layouts whose header has
 * only one button — AWTD-1175.
 *
 * It is a ROW THAT OPENS THE SEPARATE PANEL, not a tab. That distinction is
 * the whole design: task aa4e7eb0 took sort and filters out of this modal
 * because the modal is shared state and these are yours, and putting them back
 * as a tab would say the opposite of the truth again. A row that navigates to
 * the per-user panel is also what iPhone does — those screens push to a
 * sub-pane rather than merging one in — which is what Jon asked for on
 * 2026-10-12: "On mobile single column follow iOS iPhone."
 *
 * It carries the ownership line itself rather than relying on the panel it
 * opens, because the moment of confusion is here: the reader is looking at a
 * list of shared settings and about to treat this like one of them.
 *
 * Where it is NOT rendered: 3-column, where the funnel beside the gear is the
 * entry point. lib/list-view-controls.ts owns that rule for both sites.
 */

import { ChevronRight, Filter } from "lucide-react"
import { useTranslations } from "@/lib/i18n/client"

export function SortAndFiltersEntry({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslations()

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full flex items-center gap-3 px-4 py-3 text-left theme-border border-b hover:theme-bg-hover"
      data-testid="sort-filters-entry"
    >
      <Filter className="w-4 h-4 theme-text-muted shrink-0" />
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium theme-text-primary">
          {t('listSettings.sortAndFilters')}
        </span>
        <span className="block text-xs theme-text-muted">
          {t('listSettings.sortAndFiltersAreYours')}
        </span>
      </span>
      <ChevronRight className="w-4 h-4 theme-text-muted shrink-0" />
    </button>
  )
}
