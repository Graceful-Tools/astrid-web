/**
 * Server-side helpers used across POST/DELETE/PATCH handlers in
 * app/api/lists/[id]/members/route.ts. Each handler had its own copy of
 * the same three patterns:
 *
 *   - "invalidate userLists + userTasks Redis cache for these userIds"
 *   - "load the list with owner + listMembers.user so we can derive
 *      getListMemberIds(...) for SSE / cache fanout"
 *   - "check we're not about to leave the list with zero admins"
 *
 * Centralising them removes ~80 lines of duplication and makes the
 * "would-leave-no-admins" invariant a single function instead of three
 * subtly different inlines.
 *
 * Not to be confused with lib/list-member-utils.ts (read-side helpers
 * for permission/role checks against an in-memory list shape).
 */

import { prisma } from "./prisma"
import { RedisCache } from "./redis"
import { createLogger } from "./logger"

const log = createLogger("list-member-operations")

/**
 * Invalidate the per-user Redis cache (userLists + userTasks) for every
 * supplied userId. Errors are logged but never thrown — cache invalidation
 * must not fail the surrounding write.
 */
export async function invalidateMemberCaches(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return
  try {
    await Promise.all(
      userIds.flatMap(id => [
        RedisCache.del(RedisCache.keys.userLists(id)),
        RedisCache.del(RedisCache.keys.userTasks(id)),
      ]),
    )
  } catch (err) {
    log.error({ err, userIds }, "Failed to invalidate member caches")
  }
}

/** Convenience for the single-user case (most common call site). */
export function invalidateMemberCache(userId: string): Promise<void> {
  return invalidateMemberCaches([userId])
}

/**
 * Load a list with the relations needed to derive member IDs for SSE /
 * cache fanout: owner + listMembers.user.
 */
export function loadListWithMembers(listId: string) {
  return prisma.taskList.findUnique({
    where: { id: listId },
    include: {
      owner: true,
      listMembers: { include: { user: true } },
    },
  })
}

/**
 * Predicate for the "would this leave us with zero admins?" check.
 * Returns true if the operation should be blocked. The list owner counts
 * as an admin. Returns false unconditionally if `removingAdmin` is false
 * (i.e. the caller isn't actually demoting/removing an admin), so callers
 * can pass through unconditionally.
 *
 * Caller picks the error message — different routes phrase the rejection
 * differently ("Cannot remove..." vs "Cannot leave as...").
 */
export async function isLastAdminInList(args: {
  listId: string
  removingAdmin: boolean
}): Promise<boolean> {
  if (!args.removingAdmin) return false

  const adminCount = await prisma.listMember.count({
    where: { listId: args.listId, role: "admin" },
  })
  const list = await prisma.taskList.findUnique({
    where: { id: args.listId },
    select: { ownerId: true },
  })

  const totalAdmins = adminCount + (list?.ownerId ? 1 : 0)
  return totalAdmins <= 1
}
