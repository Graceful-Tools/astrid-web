import { beforeEach, describe, expect, it, vi } from 'vitest'
import { syncManualSortMemberships } from '@/lib/tasks/sync-manual-sort-memberships'
import { prisma } from '@/lib/prisma'
import { RedisCache } from '@/lib/redis'
import { broadcastToUsers } from '@/lib/sse-utils'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock('@/lib/redis', () => ({
  RedisCache: {
    invalidate: {
      userListsAllVersions: vi.fn(),
    },
  },
}))

vi.mock('@/lib/sse-utils', () => ({
  broadcastToUsers: vi.fn(),
}))

describe('syncManualSortMemberships', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.taskList.findMany).mockResolvedValue([
      { id: 'old-list', manualSortOrder: ['task-1', 'other'] },
      { id: 'new-list', manualSortOrder: ['other'] },
    ] as never)
    vi.mocked(prisma.taskList.update).mockImplementation(async ({ where, data }) => ({
      id: where.id,
      ownerId: 'owner-1',
      listMembers: [{ userId: 'member-1', role: 'member' }],
      ...data,
    }) as never)
    vi.mocked(RedisCache.invalidate.userListsAllVersions).mockResolvedValue(undefined)
    vi.mocked(broadcastToUsers).mockResolvedValue(undefined)
  })

  it('AWTD-performance loads all candidate lists once and updates memberships', async () => {
    await syncManualSortMemberships({
      taskId: 'task-1',
      previousListIds: ['old-list'],
      requestedListIds: ['new-list'],
    })

    expect(prisma.taskList.findMany).toHaveBeenCalledTimes(1)
    expect(prisma.taskList.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: ['old-list', 'new-list'] },
          sortBy: 'manual',
        },
      }),
    )
    expect(prisma.taskList.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'old-list' },
        data: { manualSortOrder: ['other'] },
      }),
    )
    expect(prisma.taskList.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'new-list' },
        data: { manualSortOrder: ['other', 'task-1'] },
      }),
    )
  })

  it('removes deleted tasks from every manual list in one batch', async () => {
    await syncManualSortMemberships({
      taskId: 'task-1',
      previousListIds: ['old-list', 'new-list'],
      requestedListIds: [],
    })

    expect(prisma.taskList.findMany).toHaveBeenCalledTimes(1)
    expect(prisma.taskList.update).toHaveBeenCalledTimes(1)
    expect(prisma.taskList.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'old-list' },
        data: { manualSortOrder: ['other'] },
      }),
    )
  })
})
