/**
 * Saving a hand-arranged task order — the rule, with no route around it.
 *
 * Shared by `POST /api/lists/:id/manual-order` and its v1 twin, the same
 * arrangement as lib/list-leave.ts and lib/list-ownership-transfer.ts: each
 * route keeps only its own auth and response envelope.
 *
 * Two things here are the whole reason a dedicated route exists at all, rather
 * than clients writing `manualSortOrder` straight through
 * `PUT /api/v1/lists/:id` (which accepts the field as a filter field):
 *
 *   - **The order is sanitized against the list's actual contents.** A raw
 *     write can persist ids of tasks that have since left the list and omit
 *     tasks that have joined, so the saved order silently drifts from what is
 *     on screen. Here, unknown ids are dropped, duplicates collapse, and tasks
 *     the caller did not mention are appended in creation order — so the stored
 *     order always describes exactly the tasks in the list.
 *   - **Every member is told.** Reordering is a shared, visible change; without
 *     the `list_updated` broadcast another open client keeps drawing the old
 *     order until something else makes it refetch.
 *
 * (Task 7883f710, filed from the Windows client, which refuses unversioned
 * paths and so could not reach the legacy route.)
 */

import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { RedisCache } from '@/lib/redis'
import { broadcastToUsers } from '@/lib/sse-utils'
import { getListMemberIds } from '@/lib/list-member-utils'
import { canUserEditTasks } from '@/lib/list-permissions'
import { createLogger } from '@/lib/logger'

const log = createLogger('list-manual-order')

export type SetListManualOrderResult =
  | { ok: true; list: Record<string, unknown>; order: string[] }
  | { ok: false; status: 400 | 403 | 404; error: string }

/**
 * Reconcile a requested order with the tasks actually in the list.
 *
 * Exported for the tests, which is worth it: this is the part a client cannot
 * do correctly on its own, because it does not know what changed in the list
 * since the drag began.
 */
export function sanitizeManualOrder(requested: unknown[], validTaskIds: string[]): string[] {
  const valid = new Set(validTaskIds)
  const requestedIds = requested.filter(
    (id): id is string => typeof id === 'string' && valid.has(id)
  )
  const unique = Array.from(new Set(requestedIds))
  const missing = validTaskIds.filter(id => !unique.includes(id))
  return [...unique, ...missing]
}

export async function setListManualOrder(args: {
  listId: string
  userId: string
  order: unknown
}): Promise<SetListManualOrderResult> {
  const { listId, userId, order } = args

  if (!Array.isArray(order)) {
    return { ok: false, status: 400, error: 'Invalid payload' }
  }

  const list = await prisma.taskList.findUnique({
    where: { id: listId },
    select: {
      id: true,
      ownerId: true,
      isVirtual: true,
      privacy: true,
      publicListType: true,
      listMembers: { select: { userId: true, role: true } },
    },
  })

  if (!list) {
    return { ok: false, status: 404, error: 'List not found' }
  }

  if (list.isVirtual) {
    return {
      ok: false,
      status: 400,
      error: 'Manual ordering is not supported for virtual lists',
    }
  }

  // `canUserEditTasks` rather than an inlined membership check (CLAUDE.md rule
  // 6). It also carries the policy the legacy route got wrong: legacy granted
  // access to ANY authenticated caller when `privacy === 'PUBLIC'`, so a
  // stranger browsing a public list could rewrite its owner's hand-arranged
  // order. The helper already distinguishes the two kinds of public list —
  // collaborative ones let viewers edit, copy-only ones (the default) do not —
  // which is the rule this repo already decided on for editing tasks.
  if (!canUserEditTasks({ id: userId }, list as never)) {
    return { ok: false, status: 403, error: 'Forbidden' }
  }

  const tasksInList = await prisma.task.findMany({
    where: { lists: { some: { id: listId } } },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  })

  const sanitizedOrder = sanitizeManualOrder(
    order,
    tasksInList.map(task => task.id)
  )

  const updatedList = await prisma.taskList.update({
    where: { id: listId },
    data: { manualSortOrder: sanitizedOrder as Prisma.JsonArray },
    include: {
      owner: { select: { id: true, name: true, email: true, image: true } },
      listMembers: { select: { userId: true, role: true } },
    },
  })

  const memberIds = getListMemberIds(updatedList)

  await Promise.all(
    memberIds.map(async id => {
      try {
        await RedisCache.invalidate.userListsAllVersions(id)
      } catch (error) {
        // The order is saved; one member's stale cache is not a failed reorder.
        log.error({ err: error, userId: id }, 'Failed to invalidate user-lists cache')
      }
    })
  )

  // Strip the per-user favorite fields: they are this caller's, and
  // broadcasting them would tell every member the list is their favorite.
  const { isFavorite: _isFavorite, favoriteOrder: _favoriteOrder, ...broadcastData } =
    updatedList as Record<string, unknown>

  try {
    await broadcastToUsers(memberIds, { type: 'list_updated', data: broadcastData })
  } catch (error) {
    // The order is saved. A failed fan-out means other clients redraw late,
    // which must not be reported as a failed reorder.
    log.error({ err: error, listId }, 'Failed to broadcast manual order update')
  }

  return { ok: true, list: updatedList as Record<string, unknown>, order: sanitizedOrder }
}
