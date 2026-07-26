/**
 * @vitest-environment node
 *
 * Delta sync could not report deletions. Tasks and lists are hard-deleted
 * (prisma.task.delete), so `updatedSince` had nothing to return for a row that
 * no longer exists — a client syncing incrementally kept showing tasks that
 * were already gone, on web, iOS and Mac alike. It is why the web reconcile had
 * to stay a full fetch.
 *
 * DeletionLog is the tombstone. The part that has to be right is the audience:
 * a deletion must reach everyone who could see the entity, and nobody else —
 * leaking ids to a stranger tells them a task existed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockPrisma } from '../setup'
import { audienceForTask, audienceForList, recordDeletion, getDeletionsSince } from '@/lib/deletion-log'

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.deletionLog.create.mockResolvedValue({} as never)
  mockPrisma.deletionLog.findMany.mockResolvedValue([] as never)
})

describe('audience scoping', () => {
  it('includes creator, assignee, list owners and list members for a task', () => {
    const task = {
      id: 't1',
      creatorId: 'creator',
      assigneeId: 'assignee',
      lists: [
        { ownerId: 'owner-a', listMembers: [{ userId: 'member-a' }] },
        { ownerId: 'owner-b', listMembers: [{ userId: 'member-b' }] },
      ],
    }

    const audience = audienceForTask(task as never)

    for (const id of ['creator', 'assignee', 'owner-a', 'member-a', 'owner-b', 'member-b']) {
      expect(audience, `${id} could see this task`).toContain(id)
    }
  })

  it('does not include an unrelated user', () => {
    // A deletion id is information: it reveals the entity existed.
    const task = { id: 't1', creatorId: 'creator', assigneeId: null, lists: [] }

    expect(audienceForTask(task as never)).not.toContain('stranger')
  })

  it('deduplicates when one person holds several roles', () => {
    const task = {
      id: 't1', creatorId: 'u1', assigneeId: 'u1',
      lists: [{ ownerId: 'u1', listMembers: [{ userId: 'u1' }] }],
    }

    expect(audienceForTask(task as never)).toEqual(['u1'])
  })

  it('drops null and undefined ids rather than storing them', () => {
    const task = { id: 't1', creatorId: null, assigneeId: undefined, lists: [{ ownerId: 'owner', listMembers: [] }] }

    expect(audienceForTask(task as never)).toEqual(['owner'])
  })

  it('covers owner and members for a list', () => {
    const list = { id: 'l1', ownerId: 'owner', listMembers: [{ userId: 'm1' }, { userId: 'm2' }] }

    const audience = audienceForList(list as never)

    expect(audience).toContain('owner')
    expect(audience).toContain('m1')
    expect(audience).toContain('m2')
  })
})

describe('recordDeletion', () => {
  it('writes a tombstone with entity, id and audience', async () => {
    await recordDeletion('task', 't1', ['u1', 'u2'])

    const data = mockPrisma.deletionLog.create.mock.calls[0][0].data
    expect(data.entity).toBe('task')
    expect(data.entityId).toBe('t1')
    expect(data.audienceIds).toEqual(['u1', 'u2'])
  })

  it('never throws — a tombstone failure must not fail the delete', async () => {
    // The user asked to delete something; losing the audit row is far less bad
    // than the delete appearing to fail after it already happened.
    mockPrisma.deletionLog.create.mockRejectedValue(new Error('db down'))

    await expect(recordDeletion('task', 't1', ['u1'])).resolves.toBeUndefined()
  })

  it('skips the write when nobody could see it', async () => {
    await recordDeletion('task', 't1', [])

    expect(mockPrisma.deletionLog.create).not.toHaveBeenCalled()
  })
})

describe('getDeletionsSince', () => {
  it('queries by entity, cursor and audience membership', async () => {
    const since = new Date('2026-07-26T12:00:00.000Z')

    await getDeletionsSince('task', 'user-1', since)

    const where = mockPrisma.deletionLog.findMany.mock.calls[0][0].where
    expect(where.entity).toBe('task')
    expect(where.deletedAt).toEqual({ gt: since })
    expect(where.audienceIds).toEqual({ has: 'user-1' })
  })

  it('returns bare ids for the client to drop', async () => {
    mockPrisma.deletionLog.findMany.mockResolvedValue([
      { entityId: 'a' }, { entityId: 'b' },
    ] as never)

    expect(await getDeletionsSince('task', 'user-1', new Date())).toEqual(['a', 'b'])
  })

  it('returns an empty list rather than throwing when the query fails', async () => {
    mockPrisma.deletionLog.findMany.mockRejectedValue(new Error('boom'))

    expect(await getDeletionsSince('task', 'user-1', new Date())).toEqual([])
  })
})
