/**
 * Task e0613ae5 — fourth slice of collapsing the duplicated legacy↔v1 routes.
 *
 * `POST /api/lists/:id/leave` and its v1 twin were two independent copies. The
 * rule now lives in lib/list-leave.ts; each route keeps its own auth and
 * response shape.
 *
 * The interesting part of this pair is the last-admin arithmetic, which is not
 * a simple count. An owner who has no `admin` row in ListMember is still an
 * admin, so the total is `adminCount + (owner has no admin row ? 1 : 0)`. Get
 * that wrong in the lenient direction and the last admin walks out of a shared
 * list, leaving members who cannot administer it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: { findUnique: vi.fn() },
    listMember: { findFirst: vi.fn(), count: vi.fn(), deleteMany: vi.fn() },
    listInvite: { deleteMany: vi.fn() },
  },
}))

vi.mock('@/lib/redis', () => ({
  RedisCache: { del: vi.fn(), keys: { userLists: (id: string) => `userLists:${id}` } },
}))

import { leaveList } from '@/lib/list-leave'
import { prisma } from '@/lib/prisma'
import { RedisCache } from '@/lib/redis'

const mockPrisma = vi.mocked(prisma)
const mockRedis = vi.mocked(RedisCache)

const LIST = { id: 'list-1', name: 'Work', ownerId: 'owner-1' }

/**
 * listMember.findFirst is called twice with different intent: first "is the
 * caller a member", then "does the owner hold an admin row". Route by the
 * where-clause rather than by call order, so a reordering does not silently
 * change what these tests mean.
 */
function memberLookup(opts: { callerRole?: string | null; ownerHasAdminRow: boolean }) {
  return async (args: { where: { userId?: string; role?: string } }) => {
    if (args.where.role === 'admin' && args.where.userId === LIST.ownerId) {
      return opts.ownerHasAdminRow ? { id: 'm-owner', role: 'admin' } : null
    }
    return opts.callerRole === null ? null : { id: 'm-caller', role: opts.callerRole }
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.taskList.findUnique.mockResolvedValue({ ...LIST } as never)
  mockPrisma.listMember.deleteMany.mockResolvedValue({ count: 1 } as never)
  mockPrisma.listInvite.deleteMany.mockResolvedValue({ count: 0 } as never)
  mockRedis.del.mockResolvedValue(undefined as never)
})

describe('leaveList (task e0613ae5)', () => {
  it('404s a list that does not exist', async () => {
    mockPrisma.taskList.findUnique.mockResolvedValue(null as never)

    const result = await leaveList({ listId: 'nope', userId: 'u-1' })

    expect(result).toMatchObject({ ok: false, status: 404 })
    expect(mockPrisma.listMember.deleteMany).not.toHaveBeenCalled()
  })

  it('404s someone who is not a member', async () => {
    mockPrisma.listMember.findFirst.mockImplementation(
      memberLookup({ callerRole: null, ownerHasAdminRow: true }) as never,
    )

    const result = await leaveList({ listId: 'list-1', userId: 'stranger' })

    expect(result).toMatchObject({ ok: false, status: 404 })
    expect(mockPrisma.listMember.deleteMany).not.toHaveBeenCalled()
  })

  it('lets a plain member leave without any admin arithmetic', async () => {
    mockPrisma.listMember.findFirst.mockImplementation(
      memberLookup({ callerRole: 'member', ownerHasAdminRow: true }) as never,
    )

    const result = await leaveList({ listId: 'list-1', userId: 'u-1', userEmail: 'u@example.com' })

    expect(result).toEqual({ ok: true })
    expect(mockPrisma.listMember.count).not.toHaveBeenCalled()
  })

  it('refuses the LAST admin, and says so', async () => {
    mockPrisma.listMember.findFirst.mockImplementation(
      memberLookup({ callerRole: 'admin', ownerHasAdminRow: true }) as never,
    )
    mockPrisma.listMember.count.mockResolvedValue(1 as never)

    const result = await leaveList({ listId: 'list-1', userId: 'owner-1' })

    expect(result).toMatchObject({ ok: false, status: 400, isLastAdmin: true })
    expect(mockPrisma.listMember.deleteMany).not.toHaveBeenCalled()
  })

  it('lets an admin leave when another admin remains', async () => {
    mockPrisma.listMember.findFirst.mockImplementation(
      memberLookup({ callerRole: 'admin', ownerHasAdminRow: true }) as never,
    )
    mockPrisma.listMember.count.mockResolvedValue(2 as never)

    const result = await leaveList({ listId: 'list-1', userId: 'admin-2' })

    expect(result).toEqual({ ok: true })
  })

  it('counts an owner with NO admin row as an admin', async () => {
    // The arithmetic that is easy to lose. One admin row + an owner who holds
    // no admin row = two admins, so that one admin may leave. Drop the +1 and
    // this user is wrongly told they are the last admin.
    mockPrisma.listMember.findFirst.mockImplementation(
      memberLookup({ callerRole: 'admin', ownerHasAdminRow: false }) as never,
    )
    mockPrisma.listMember.count.mockResolvedValue(1 as never)

    const result = await leaveList({ listId: 'list-1', userId: 'admin-2' })

    expect(result).toEqual({ ok: true })
  })

  it('clears a pending invitation so leaving actually sticks', async () => {
    mockPrisma.listMember.findFirst.mockImplementation(
      memberLookup({ callerRole: 'member', ownerHasAdminRow: true }) as never,
    )

    await leaveList({ listId: 'list-1', userId: 'u-1', userEmail: 'u@example.com' })

    expect(mockPrisma.listInvite.deleteMany).toHaveBeenCalledWith({
      where: { listId: 'list-1', email: 'u@example.com' },
    })
  })

  it('still lets a user with no email leave', async () => {
    // Legacy asserted `session.user.email!` here. v1 guarded it, and that is
    // the version kept: no email is not a reason to be stuck in a list.
    mockPrisma.listMember.findFirst.mockImplementation(
      memberLookup({ callerRole: 'member', ownerHasAdminRow: true }) as never,
    )

    const result = await leaveList({ listId: 'list-1', userId: 'u-1', userEmail: null })

    expect(result).toEqual({ ok: true })
    expect(mockPrisma.listInvite.deleteMany).not.toHaveBeenCalled()
  })

  it('leaves successfully even if cache invalidation blows up', async () => {
    mockPrisma.listMember.findFirst.mockImplementation(
      memberLookup({ callerRole: 'member', ownerHasAdminRow: true }) as never,
    )
    mockRedis.del.mockRejectedValue(new Error('redis down') as never)

    const result = await leaveList({ listId: 'list-1', userId: 'u-1' })

    // The membership row is already gone; failing the request here would tell
    // the user they are still in a list they have left.
    expect(result).toEqual({ ok: true })
  })

  it('404s if the delete removed nothing (raced with another leave)', async () => {
    mockPrisma.listMember.findFirst.mockImplementation(
      memberLookup({ callerRole: 'member', ownerHasAdminRow: true }) as never,
    )
    mockPrisma.listMember.deleteMany.mockResolvedValue({ count: 0 } as never)

    const result = await leaveList({ listId: 'list-1', userId: 'u-1' })

    expect(result).toMatchObject({ ok: false, status: 404 })
  })
})
