/**
 * Resolving a list's default assignee to a user. (Task dc143ab2)
 *
 * Legacy `/api/lists` enriches its raw rows with a resolved `defaultAssignee`;
 * the v1 projections carried only `defaultAssigneeId`. A client holding an id
 * it has no user for renders every assignee name and avatar blank — no error,
 * nothing to indicate a field is missing. Two v1 routes needed the same fix,
 * so the lookup lives here rather than becoming a third copy of it.
 *
 * Two things this has to get right:
 *
 * - **`"unassigned"` is a sentinel, not an id.** Looking it up misses, and the
 *   raw string leaks to the client as a broken user reference.
 * - **One query, not one per list.** A per-list lookup is an N+1 on the
 *   hottest read in the app; legacy batches for exactly this reason.
 */

import { prisma } from '@/lib/prisma'
import { SAFE_USER_SELECT } from '@/lib/task-query-utils'

/** Sentinel stored in `defaultAssigneeId` to mean "explicitly nobody". */
const UNASSIGNED = 'unassigned'

export function isRealAssigneeId(id: string | null | undefined): id is string {
  return !!id && id !== UNASSIGNED
}

/**
 * Batch-resolve the default assignees for a set of lists.
 * Returns a map keyed by user id; lists with no assignee simply have no entry.
 */
export async function resolveDefaultAssignees<T extends { defaultAssigneeId?: string | null }>(
  lists: T[]
): Promise<Map<string, unknown>> {
  const ids = [...new Set(lists.map((list) => list.defaultAssigneeId).filter(isRealAssigneeId))]

  const map = new Map<string, unknown>()
  if (ids.length === 0) return map

  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: SAFE_USER_SELECT,
  })
  for (const user of users) {
    map.set(user.id, user)
  }
  return map
}

/** The resolved user for one list, or null — including for the sentinel. */
export function pickDefaultAssignee(
  defaultAssigneeId: string | null | undefined,
  resolved: Map<string, unknown>
): unknown {
  return isRealAssigneeId(defaultAssigneeId) ? resolved.get(defaultAssigneeId) ?? null : null
}
