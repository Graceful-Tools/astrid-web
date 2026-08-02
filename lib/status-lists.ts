/**
 * Status lists are per-user singletons — one Ready / Doing / Waiting, shared
 * across every board that user has.
 *
 * This file exists because that invariant was broken twice in the same way.
 * The first board release seeded a fresh set per project; migration
 * 20260516000000_per_user_status_lists consolidated them. Then migration
 * 20260731010000_project_scoped_statuses did it again — to give shared boards
 * a status both members could resolve — and a user with two boards ended up
 * with nine status lists surfacing as duplicates in every picker.
 *
 * The rule, in one place so it stops being re-derived:
 *
 *   A user has exactly one status list per role. A status list is a STATE,
 *   not a destination: it is never offered in a list picker, and the tasks in
 *   it span every project the user has.
 */

import type { TaskList } from '@/types/task'
import { isDomainList, isStatusList } from '@/lib/list-flavors'

/** Ordered roles. Inbox and Done stay virtual — they are derived from task state. */
export const STATUS_ROLE_ORDER = ['ready', 'doing', 'waiting'] as const

type ListLike = Pick<TaskList, 'id' | 'listType'> & {
  statusRole?: string | null
  projectId?: string | null
  statusOrder?: number | null
  name?: string
}

/**
 * The user's status lists: exactly one per role, in display order.
 *
 * Deduplicates by role, preferring the durable per-user row (`projectId` null)
 * over any project-scoped leftover, so the board renders correctly even while
 * the cleanup migration has not yet run — or on a client holding a stale list
 * set from before it did.
 */
export function statusListsForUser<T extends ListLike>(lists: T[]): T[] {
  const byRole = new Map<string, T>()

  for (const list of lists) {
    if (!isStatusList(list)) continue
    const role = list.statusRole
    if (!role) continue

    const existing = byRole.get(role)
    if (!existing) {
      byRole.set(role, list)
      continue
    }
    // Per-user row wins over a project-scoped duplicate.
    if (existing.projectId && !list.projectId) byRole.set(role, list)
  }

  const ordered: T[] = []
  for (const role of STATUS_ROLE_ORDER) {
    const list = byRole.get(role)
    if (list) ordered.push(list)
  }
  // Any custom role the user added, after the defaults.
  for (const [role, list] of byRole) {
    if (!(STATUS_ROLE_ORDER as readonly string[]).includes(role)) ordered.push(list)
  }
  return ordered
}

/**
 * Lists that may be offered as a destination in a picker.
 *
 * Excludes status lists (a state, not a place), labels (a tag, not a place) and
 * virtual lists (a saved filter). The picker previously excluded only virtual
 * lists, which is how nine status lists ended up in the Lists field.
 */
export function selectableLists<T extends ListLike & { isVirtual?: boolean }>(lists: T[]): T[] {
  return filterSelectable(lists)
}

function filterSelectable<T extends ListLike & { isVirtual?: boolean }>(lists: T[]): T[] {
  return lists.filter(list => isDomainList(list) && !list.isVirtual)
}
