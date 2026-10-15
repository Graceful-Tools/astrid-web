/**
 * Where a list's Sort & Filters control lives, by layout — AWTD-1175.
 *
 * Sort and filters are PER-USER state (lib/list-view-preferences.ts); List
 * Settings is the list itself, shared with everyone who can see it. Task
 * aa4e7eb0 split them apart on 2026-09-13 for that reason, and the split
 * stands: "every other tab in that modal changes the list for everyone, so a
 * reasonable person read the first one the same way".
 *
 * But the funnel it moved to — ListFilterRow — was only ever rendered in the
 * 3-column header. Below that, a user list's header has ONE button, the gear,
 * and the gear opens a modal that no longer contains sort or filters. So from
 * 2026-09-13 until this change **a user list on a narrow layout could not be
 * sorted or filtered at all**. System lists were unaffected: their popover has
 * always been a filter panel reached from a funnel.
 *
 * Jon, 2026-10-12, asked for iPhone's shape where there is only one button:
 * *"On mobile single column follow iOS iPhone. On 3 column spit out the filter
 * / sort web."*
 *
 * Hence one rule, two complementary readings, in one place so the funnel's gate
 * and the List Settings entry cannot drift apart again. The bug was precisely
 * that two places decided this independently and a layout fell between them.
 *
 * Note what this does NOT do: below 3 columns Sort & Filters is *reached
 * through* List Settings, but it is still its own panel with its own "only you
 * see these" line. The entry point moves; the ownership seam does not.
 */

// The layout vocabulary already exists; a second spelling of 1 | 2 | 3 here
// would be one more thing to keep in step (CLAUDE.md rule 6).
import type { ColumnCount } from '@/lib/layout-detection'

export type { ColumnCount }

/**
 * True where the list header has room for a control of its own — the funnel
 * sitting on the line above the tasks, beside the gear.
 */
export function sortAndFiltersIsItsOwnControl(columnCount: ColumnCount): boolean {
  return columnCount === 3
}

/**
 * True where the header has one button, so Sort & Filters is reached through
 * List Settings instead — as on iPhone.
 */
export function sortAndFiltersLivesInListSettings(columnCount: ColumnCount): boolean {
  return !sortAndFiltersIsItsOwnControl(columnCount)
}
