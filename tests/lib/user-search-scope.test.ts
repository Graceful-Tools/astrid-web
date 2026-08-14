/**
 * Task e0613ae5 — user search must only search lists the caller belongs to.
 *
 * Both `/api/users/search` and `/api/v1/users/search` took `listIds` and
 * `taskId` from the query string and returned those lists' members with their
 * EMAIL ADDRESSES, with no check that the caller had any relationship to them.
 * Identical in both, so no amount of comparing the two would have surfaced it.
 *
 * The rules under test:
 *   - a list the caller neither owns nor belongs to is dropped
 *   - a taskId the caller cannot see yields nothing
 *   - PUBLIC is NOT a qualifier: reading a public list does not entitle you to
 *     its members' email addresses
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: { findMany: vi.fn() },
    task: { findFirst: vi.fn() },
  },
}))

import { resolveSearchListIds } from '@/lib/user-search-scope'
import { prisma } from '@/lib/prisma'

const mockPrisma = vi.mocked(prisma)
const USER = 'user-1'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resolveSearchListIds (task e0613ae5)', () => {
  it('keeps only the requested lists the caller belongs to', async () => {
    // Caller asks about three lists; the database says they can see one.
    mockPrisma.taskList.findMany.mockResolvedValue([{ id: 'mine' }] as never)

    const result = await resolveSearchListIds({
      userId: USER,
      listIds: ['mine', 'someone-elses', 'also-not-mine'],
    })

    expect(result).toEqual(['mine'])
  })

  it('scopes the visibility query to the caller — owner OR member', async () => {
    mockPrisma.taskList.findMany.mockResolvedValue([] as never)

    await resolveSearchListIds({ userId: USER, listIds: ['l1'] })

    const where = (mockPrisma.taskList.findMany.mock.calls[0][0] as never as {
      where: { id: { in: string[] }; OR: Record<string, unknown>[] }
    }).where
    expect(where.id).toEqual({ in: ['l1'] })
    expect(where.OR).toEqual([
      { ownerId: USER },
      { listMembers: { some: { userId: USER } } },
    ])
  })

  it('does NOT treat a public list as searchable', async () => {
    // Being able to READ a public list must not hand over its members' email
    // addresses. The absence of a `privacy: 'PUBLIC'` branch is the assertion.
    mockPrisma.taskList.findMany.mockResolvedValue([] as never)

    await resolveSearchListIds({ userId: USER, listIds: ['public-list'] })

    const where = JSON.stringify(
      (mockPrisma.taskList.findMany.mock.calls[0][0] as never as { where: unknown }).where,
    )
    expect(where).not.toContain('PUBLIC')
  })

  it('returns nothing for a task the caller cannot see', async () => {
    mockPrisma.task.findFirst.mockResolvedValue(null as never)

    const result = await resolveSearchListIds({ userId: USER, taskId: 'not-mine' })

    expect(result).toEqual([])
    // No point asking which lists are visible when the task itself is not.
    expect(mockPrisma.taskList.findMany).not.toHaveBeenCalled()
  })

  it("uses a visible task's lists, still filtered by membership", async () => {
    mockPrisma.task.findFirst.mockResolvedValue({
      lists: [{ id: 'l1' }, { id: 'l2' }],
    } as never)
    // The caller can see the task (say, via l1) but belongs only to l1.
    mockPrisma.taskList.findMany.mockResolvedValue([{ id: 'l1' }] as never)

    const result = await resolveSearchListIds({ userId: USER, taskId: 'task-1' })

    expect(result).toEqual(['l1'])
  })

  it('returns nothing when neither listIds nor taskId is given', async () => {
    const result = await resolveSearchListIds({ userId: USER })

    expect(result).toEqual([])
    expect(mockPrisma.taskList.findMany).not.toHaveBeenCalled()
  })
})
