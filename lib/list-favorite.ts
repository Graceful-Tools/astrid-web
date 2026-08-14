/**
 * Toggling a list's favorite state — the rule, with no route around it.
 *
 * Shared by `PATCH /api/lists/:id/favorite` and its v1 twin, which were two
 * independent copies. Same reasoning as lib/reminder-snooze.ts and
 * lib/reminder-dismiss.ts: the routes are not collapsed, because v1's response
 * carries a `meta` envelope and legacy's does not, so each keeps its own auth
 * and formatting and shares the part that was actually duplicated.
 * (Task e0613ae5.)
 */

import { prisma } from '@/lib/prisma'
import { toggleFavorite, hydrateSingleListFavorite } from '@/lib/favorites'

/** `defaultAssigneeId` may hold this sentinel instead of a user id. */
const UNASSIGNED = 'unassigned'

export type SetListFavoriteResult =
  | { ok: true; list: Record<string, unknown>; isFavorite: boolean }
  | { ok: false; status: 404 | 500; error: string }

export async function setListFavorite(args: {
  userId: string
  listId: string
  isFavorite: boolean
}): Promise<SetListFavoriteResult> {
  const { userId, listId, isFavorite } = args

  // Owner or member — a list the caller cannot see must not gain a favorite row.
  const list = await prisma.taskList.findFirst({
    where: {
      id: listId,
      OR: [
        { ownerId: userId },
        { listMembers: { some: { userId } } },
      ],
    },
  })

  if (!list) {
    return { ok: false, status: 404, error: 'List not found or access denied' }
  }

  await toggleFavorite(userId, listId, isFavorite)

  const updatedList = await prisma.taskList.findUnique({
    where: { id: listId },
    include: {
      owner: true,
      listMembers: { include: { user: true } },
    },
  })

  if (!updatedList) {
    return { ok: false, status: 500, error: 'Failed to fetch updated list' }
  }

  // Only resolve a real id — "unassigned" is a sentinel and would never match.
  let defaultAssignee = null
  if (updatedList.defaultAssigneeId && updatedList.defaultAssigneeId !== UNASSIGNED) {
    defaultAssignee = await prisma.user.findUnique({
      where: { id: updatedList.defaultAssigneeId },
    })
  }

  const updatedListWithDefaultAssignee = { ...updatedList, defaultAssignee }
  await hydrateSingleListFavorite(updatedListWithDefaultAssignee, userId)

  return { ok: true, list: updatedListWithDefaultAssignee, isFavorite }
}
