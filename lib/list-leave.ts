/**
 * Leaving a list — the rule, with no route around it.
 *
 * Shared by `POST /api/lists/:id/leave` and its v1 twin, which were two
 * independent copies. Same reasoning as lib/reminder-snooze.ts,
 * lib/reminder-dismiss.ts and lib/list-favorite.ts: the routes are not
 * collapsed, because v1's response carries a `meta` envelope and legacy's does
 * not, so each keeps its own auth and formatting and shares the part that was
 * actually duplicated. (Task e0613ae5.)
 *
 * Where the two copies disagreed, this takes v1's version: legacy asserted
 * `session.user.email!` non-null when clearing pending invites, v1 guarded it.
 * A user without an email should still be able to leave a list.
 */

import { prisma } from '@/lib/prisma'
import { RedisCache } from '@/lib/redis'
import { canUserManageList } from '@/lib/list-permissions'
import { createLogger } from '@/lib/logger'

const log = createLogger('list-leave')

export type LeaveListResult =
  | { ok: true }
  | { ok: false; status: 400 | 404; error: string; isLastAdmin?: true }

export async function leaveList(args: {
  listId: string
  userId: string
  userEmail?: string | null
}): Promise<LeaveListResult> {
  const { listId, userId, userEmail } = args

  const list = await prisma.taskList.findUnique({
    where: { id: listId },
    select: { id: true, name: true, ownerId: true },
  })
  if (!list) {
    return { ok: false, status: 404, error: 'List not found' }
  }

  const userMember = await prisma.listMember.findFirst({ where: { listId, userId } })
  if (!userMember) {
    return { ok: false, status: 404, error: 'You are not a member of this list' }
  }

  // Owner counts as an admin for leave purposes even without a member row.
  const isUserAdmin =
    userMember.role === 'admin' || canUserManageList({ id: userId }, list as never)

  if (isUserAdmin) {
    const adminCount = await prisma.listMember.count({ where: { listId, role: 'admin' } })

    // If the owner has no admin member row they are not in adminCount, but they
    // are still an admin — otherwise the last co-admin would be told they are
    // the last admin while an owner is sitting right there.
    const ownerIsAdmin = await prisma.listMember.findFirst({
      where: { listId, userId: list.ownerId, role: 'admin' },
    })
    const totalAdmins = adminCount + (list.ownerId && !ownerIsAdmin ? 1 : 0)

    if (totalAdmins <= 1) {
      return {
        ok: false,
        status: 400,
        error:
          'Cannot leave as the last admin. Either promote another member to admin or delete the list.',
        isLastAdmin: true,
      }
    }
  }

  const deleteResult = await prisma.listMember.deleteMany({ where: { listId, userId } })
  if (deleteResult.count === 0) {
    return { ok: false, status: 404, error: 'You are not a member of this list' }
  }

  // Drop any pending invitation, or rejoining is offered to someone who just left.
  if (userEmail) {
    await prisma.listInvite.deleteMany({ where: { listId, email: userEmail } })
  }

  // Best-effort: the user has already left, so a cold cache is not a failure.
  try {
    await RedisCache.del(RedisCache.keys.userLists(userId))
  } catch (error) {
    log.error({ err: error, userId }, 'Failed to invalidate user-lists cache')
  }

  return { ok: true }
}
