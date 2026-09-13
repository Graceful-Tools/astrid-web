"use client"

/**
 * Sort & Filters, on its own — outside List Settings (task aa4e7eb0).
 *
 * This panel used to be the first tab inside the "List Settings" modal, beside
 * Membership, Statuses and Admin Settings. That placement was the bug as much
 * as the storage was: every other tab in that modal changes the list for
 * everyone who can see it, so a reasonable person read the first one the same
 * way — and until today they were right, because sort and filters really were
 * columns on the shared list row.
 *
 * Now that they are per-user, keeping them in that modal would say the opposite
 * of the truth. So the seam follows the ownership: List Settings is what the
 * list IS and is shared; this is how YOU are looking at it and is yours.
 * (Jon, 2026-09-13: "separate out the sort from Admin/membership".)
 *
 * It reuses SettingsModalShell — the same chrome, dismissal and mobile
 * behaviour as the two settings popovers — and renders the existing
 * ListSortAndFilters body unchanged, so this is a move rather than a rewrite.
 *
 * System lists already worked this way: they get FixedListSettingsPopover,
 * which has only ever been a filter panel, reached from a Filter button rather
 * than a gear. This brings user lists into line with that.
 */

import React from "react"
import { Filter } from "lucide-react"
import { SettingsModalShell } from "@/components/list-settings/SettingsModalShell"
import { ListSortAndFilters } from "@/components/list-sort-and-filters"
import { useTranslations } from "@/lib/i18n/client"
import type { TaskList, User } from "@/types/task"

export interface ListSortAndFiltersPopoverProps {
  list: TaskList
  currentUser: User
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdate: (list: TaskList) => void
  onFavoriteToggle?: (listId: string) => void
  /** Gates the list-level "Show subtasks" toggle inside the panel. */
  canEditSettings?: boolean
}

export function ListSortAndFiltersPopover({
  list,
  currentUser,
  open,
  onOpenChange,
  onUpdate,
  onFavoriteToggle,
  canEditSettings = false,
}: ListSortAndFiltersPopoverProps) {
  const { t } = useTranslations()

  return (
    <SettingsModalShell
      open={open}
      onOpenChange={onOpenChange}
      header={
        <>
          <Filter className="w-4 h-4 theme-text-muted" />
          <h2 className="text-lg font-semibold theme-text-primary">
            {t('listSettings.sortAndFilters')}
          </h2>
        </>
      }
      // The whole point of moving it: say whose settings these are, where the
      // person is looking, instead of leaving them to infer it from the tab
      // they happen to be on.
      subtitle={t('listSettings.sortAndFiltersAreYours')}
    >
      <div className="p-4 pb-40 md:pb-4">
        <ListSortAndFilters
          list={list}
          currentUser={currentUser}
          onUpdate={onUpdate}
          onFavoriteToggle={onFavoriteToggle}
          canEditSettings={canEditSettings}
        />
      </div>
    </SettingsModalShell>
  )
}
