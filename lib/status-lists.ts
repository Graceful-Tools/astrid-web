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
import { isDomainList } from '@/lib/list-flavors'

type ListLike = Pick<TaskList, 'id' | 'listType'> & {
  statusRole?: string | null
  projectId?: string | null
  statusOrder?: number | null
  name?: string
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
