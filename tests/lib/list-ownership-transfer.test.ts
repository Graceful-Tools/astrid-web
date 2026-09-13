/**
 * Task 359ca48f — `POST /api/v1/lists/:id/transfer-ownership`, the route the
 * Mac/iOS "Transfer Ownership & Leave" control is waiting on.
 *
 * Same shape as lib/list-leave.ts (task e0613ae5): the rule lives here with no
 * route around it, so the v1 door and the legacy one cannot drift. Each route
 * keeps only its own auth and response envelope.
 *
 * The part worth pinning down is that the transfer is ONE transaction. It
 * changes `ownerId` and removes two membership rows, and a partial application
 * of that is a list with an owner who is also a plain member, or worse a list
 * whose old owner has already been removed while ownership never moved — i.e.
 * a list nobody can administer.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: { findUnique: vi.fn() },
    listMember: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock('@/lib/redis', () => ({
  RedisCache: { invalidate: { userListsAllVersions: vi.fn() } },
}))

import { transferListOwnership } from '@/lib/list-ownership-transfer'
import { prisma } from '@/lib/prisma'
import { RedisCache } from '@/lib/redis'

const mockPrisma = vi.mocked(prisma, true)
const mockRedis = vi.mocked(RedisCache, true)

const LIST = { id: 'list-1', ownerId: 'owner-1' }
const NEW_OWNER_MEMBER = { id: 'member-1', listId: 'list-1', userId: 'new-owner-1', role: 'admin' }

type MockTx = {
  taskList: { update: ReturnType<typeof vi.fn> }
  listMember: { deleteMany: ReturnType<typeof vi.fn> }
}

/** Captures the tx callback's writes so their content, not just their count, can be asserted. */
function captureTransaction(): MockTx {
  const tx: MockTx = {
    taskList: { update: vi.fn() },
    listMember: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
  }
  mockPrisma.$transaction.mockImplementation((async (cb: (t: MockTx) => unknown) => cb(tx)) as never)
  return tx
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.taskList.findUnique.mockResolvedValue({ ...LIST } as never)
  mockPrisma.listMember.findFirst.mockResolvedValue({ ...NEW_OWNER_MEMBER } as never)
  mockRedis.invalidate.userListsAllVersions.mockResolvedValue(undefined as never)
})

describe('transferListOwnership (task 359ca48f)', () => {
  it('moves ownership and removes both membership rows in a single transaction', async () => {
    const tx = captureTransaction()

    const result = await transferListOwnership({
      listId: 'list-1',
      currentUserId: 'owner-1',
      newOwnerId: 'new-owner-1',
    })

    expect(result).toEqual({ ok: true })
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
    expect(tx.taskList.update).toHaveBeenCalledWith({
      where: { id: 'list-1' },
      data: { ownerId: 'new-owner-1' },
    })
    // The new owner's row goes because they are the owner now; the old owner's
    // goes because "Transfer Ownership & Leave" is one action, not two calls.
    expect(tx.listMember.deleteMany).toHaveBeenCalledWith({
      where: { listId: 'list-1', userId: { in: ['new-owner-1', 'owner-1'] } },
    })
  })

  it('invalidates the lists cache for BOTH the old and the new owner', async () => {
    captureTransaction()

    await transferListOwnership({
      listId: 'list-1',
      currentUserId: 'owner-1',
      newOwnerId: 'new-owner-1',
    })

    expect(mockRedis.invalidate.userListsAllVersions).toHaveBeenCalledWith('owner-1')
    expect(mockRedis.invalidate.userListsAllVersions).toHaveBeenCalledWith('new-owner-1')
    expect(mockRedis.invalidate.userListsAllVersions).toHaveBeenCalledTimes(2)
  })

  it('still reports success when cache invalidation fails', async () => {
    captureTransaction()
    mockRedis.invalidate.userListsAllVersions.mockRejectedValue(new Error('redis down') as never)

    const result = await transferListOwnership({
      listId: 'list-1',
      currentUserId: 'owner-1',
      newOwnerId: 'new-owner-1',
    })

    // The transfer is committed. A cold cache is not a reason to tell the
    // caller the transfer failed and have them retry it.
    expect(result).toEqual({ ok: true })
  })

  it('400s a missing newOwnerId without touching the database', async () => {
    const result = await transferListOwnership({
      listId: 'list-1',
      currentUserId: 'owner-1',
      newOwnerId: '',
    })

    expect(result).toMatchObject({ ok: false, status: 400 })
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('404s a list that does not exist', async () => {
    mockPrisma.taskList.findUnique.mockResolvedValue(null as never)

    const result = await transferListOwnership({
      listId: 'nope',
      currentUserId: 'owner-1',
      newOwnerId: 'new-owner-1',
    })

    expect(result).toMatchObject({ ok: false, status: 404 })
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('403s an admin who is not the owner', async () => {
    const result = await transferListOwnership({
      listId: 'list-1',
      currentUserId: 'admin-1',
      newOwnerId: 'new-owner-1',
    })

    expect(result).toMatchObject({ ok: false, status: 403 })
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('403s the owner of the list’s PROJECT, who is not the list owner', async () => {
    // getUserRoleInList resolves a project owner to "admin", deliberately, so
    // owning the board must not confer the power to hand away someone's list.
    mockPrisma.taskList.findUnique.mockResolvedValue({
      ...LIST,
      projectId: 'proj-1',
      project: { id: 'proj-1', ownerId: 'project-owner-1', members: [], lists: [] },
    } as never)

    const result = await transferListOwnership({
      listId: 'list-1',
      currentUserId: 'project-owner-1',
      newOwnerId: 'new-owner-1',
    })

    expect(result).toMatchObject({ ok: false, status: 403 })
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('400s a successor who is not already a member of the list', async () => {
    mockPrisma.listMember.findFirst.mockResolvedValue(null as never)

    const result = await transferListOwnership({
      listId: 'list-1',
      currentUserId: 'owner-1',
      newOwnerId: 'stranger-1',
    })

    expect(result).toMatchObject({ ok: false, status: 400 })
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it('treats a transfer to yourself as a real no-op, not a silent self-removal', async () => {
    // The legacy route answered 200 here and called this a no-op, but it was
    // not one: it wrote the ownerId already in place and then deleted the
    // caller's own membership row. The 200 stays; the stray delete goes.
    mockPrisma.listMember.findFirst.mockResolvedValue({
      ...NEW_OWNER_MEMBER,
      userId: 'owner-1',
    } as never)

    const result = await transferListOwnership({
      listId: 'list-1',
      currentUserId: 'owner-1',
      newOwnerId: 'owner-1',
    })

    expect(result).toEqual({ ok: true })
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })
})
