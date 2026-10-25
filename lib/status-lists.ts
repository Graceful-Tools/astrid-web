/**
 * Which lists may be offered as a destination.
 *
 * This file used to carry the status-list rules as well — one Ready / Doing /
 * Waiting per user, deduplicated by role, never per project. That invariant
 * was broken twice by migrations that seeded a set per board (a user with two
 * boards ended up with nine status lists, surfacing as duplicates in every
 * picker), which is why it had a module of its own.
 *
 * Stage D (task b7b0c2f5) deleted the rows, so there is no set to deduplicate:
 * board columns are `DEFAULT_STATES` config plus the board's own
 * `Project.customStates`. `statusListsForUser` went with them.
 *
 * What survives is the picker rule, which is about lists and not about status.
 */

import type { TaskList } from '@/types/task'
import { filterLabelLists, isDomainList } from '@/lib/list-flavors'

type ListLike = Pick<TaskList, 'id' | 'listType'> & {
  statusRole?: string | null
  projectId?: string | null
  statusOrder?: number | null
  name?: string
  isFavorite?: boolean
  favoriteOrder?: number | null
}

/**
 * Lists that may be offered as a destination in a picker.
 *
 * Excludes labels (a tag, not a place), virtual lists (a saved filter) and any
 * leftover status row (a state, not a place). The picker previously excluded
 * only virtual lists, which is how nine status lists ended up in the Lists
 * field.
 */
export function selectableLists<T extends ListLike & { isVirtual?: boolean }>(lists: T[]): T[] {
  return lists.filter(list => isDomainList(list) && !list.isVirtual)
}

/**
 * The order a list picker offers lists in: favorites first by favoriteOrder,
 * then the rest by name — the order the sidebar shows them in.
 *
 * A picker must not trust the order it was handed (AWTD-1308). GET
 * /api/v1/lists has no ORDER BY on a full sync, so the client holds lists in
 * Postgres heap order, and every UPDATE moves a row to the end of the heap:
 * the busiest list is always last. Returns a new array.
 */
export function orderListsForPicker<T extends ListLike>(lists: T[]): T[] {
  return [...lists].sort((a, b) => {
    if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1
    if (a.isFavorite && b.isFavorite) {
      const byOrder = (a.favoriteOrder ?? 0) - (b.favoriteOrder ?? 0)
      if (byOrder !== 0) return byOrder
    }
    return (a.name ?? '').localeCompare(b.name ?? '', undefined, { sensitivity: 'base' })
  })
}

/**
 * What task detail's Lists editor offers: every destination, then labels (a
 * label is a tag that may also be applied there), minus virtual lists, lists
 * already chosen, and — when something is typed — lists whose name does not
 * contain it.
 *
 * Uncapped on purpose (AWTD-1308): the old `.slice(0, 10)` meant a list past
 * the tenth was reachable only by searching. The dropdown scrolls.
 */
export function listPickerSuggestions<T extends ListLike & { isVirtual?: boolean; name: string }>(
  lists: T[],
  selected: Array<{ id: string }>,
  searchTerm: string,
): T[] {
  const selectedIds = new Set(selected.map(list => list.id))
  const needle = searchTerm.trim().toLowerCase()
  const labels = filterLabelLists(lists).filter(list => !list.isVirtual)
  return [...orderListsForPicker(selectableLists(lists)), ...orderListsForPicker(labels)]
    .filter(list => !selectedIds.has(list.id))
    .filter(list => !needle || list.name.toLowerCase().includes(needle))
}
