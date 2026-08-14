/**
 * What `isLastAdminInList` actually does — task e0613ae5 / 10579245.
 *
 * I nearly "fixed" v1 by adding this guard to
 * /api/v1/lists/:id/members/:userId, which legacy calls and v1 does not.
 * Checking first showed the guard CANNOT FIRE, so adding it would have been
 * ceremony sold as a security fix.
 *
 * The reason is structural rather than a typo:
 *
 *     const totalAdmins = adminCount + (list?.ownerId ? 1 : 0)
 *     return totalAdmins <= 1
 *
 * `removingAdmin: true` means the target IS an admin, so adminCount >= 1.
 * `TaskList.ownerId` is `String` — NON-NULLABLE in schema.prisma — so the owner
 * always adds 1. Total is therefore always >= 2 for any list that exists, and
 * the predicate always returns false.
 *
 * IS THAT A BUG? No, and that is the point of writing it down. A list can never
 * be stranded without an administrator, because the owner is always an
 * administrator and cannot be removed. The guard defends a state the schema
 * makes unreachable.
 *
 * So the three legacy call sites are dead branches — "Cannot remove the last
 * admin", "Cannot leave as the last admin" — and v1 is not missing a
 * protection. These tests pin that, so the next person to notice the asymmetry
 * finds this instead of adding a no-op to v1.
 *
 * If the intent was ever "a list must keep an admin BESIDES its owner", that is
 * a different rule and is not implemented anywhere.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const count = vi.hoisted(() => vi.fn())
const findUnique = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({
  prisma: { listMember: { count }, taskList: { findUnique } },
}))

import { isLastAdminInList } from '@/lib/list-member-operations'

beforeEach(() => {
  vi.clearAllMocks()
  // Every real list has an owner; ownerId is non-nullable.
  findUnique.mockResolvedValue({ ownerId: 'owner-1' })
})

describe('isLastAdminInList', () => {
  it('short-circuits to false when the target is not an admin', async () => {
    expect(await isLastAdminInList({ listId: 'l1', removingAdmin: false })).toBe(false)
    // No queries at all — the cheap path is also the common one.
    expect(count).not.toHaveBeenCalled()
  })

  it('does NOT block removing the only admin, because the owner still administers', async () => {
    count.mockResolvedValue(1)

    // 1 admin + 1 owner = 2, so the <= 1 test fails and the removal proceeds.
    // This is the case the guard reads as if it prevents, and does not.
    expect(await isLastAdminInList({ listId: 'l1', removingAdmin: true })).toBe(false)
  })

  it('cannot fire for any list that exists, at any admin count', async () => {
    for (const admins of [1, 2, 5, 50]) {
      count.mockResolvedValue(admins)
      expect(await isLastAdminInList({ listId: 'l1', removingAdmin: true })).toBe(false)
    }
  })

  it('would only fire for an ownerless list, which the schema forbids', async () => {
    // Documents the one branch that returns true. TaskList.ownerId is `String`,
    // not `String?`, so this state is unreachable — it is reproduced here only
    // to show that the true-branch needs an ownerless list, not a rare race.
    findUnique.mockResolvedValue(null)
    count.mockResolvedValue(1)

    expect(await isLastAdminInList({ listId: 'gone', removingAdmin: true })).toBe(true)
  })
})
