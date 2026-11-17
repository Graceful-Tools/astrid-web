import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    agentListPresence: { findMany: vi.fn(), updateMany: vi.fn(), upsert: vi.fn() },
    task: { findFirst: vi.fn() },
    taskList: { findMany: vi.fn() },
  },
}))
vi.mock('@/lib/notification-store', () => ({ persistNotifications: vi.fn().mockResolvedValue(1) }))

import { notifyQuietAgents, recordAgentQueueCheck } from '@/services/agent-presence.service'
import { persistNotifications } from '@/lib/notification-store'
import { prisma } from '@/lib/prisma'

const now = new Date('2026-11-16T12:00:00.000Z')
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000)

describe('agent presence service (AWTD-1697)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.task.findFirst).mockResolvedValue({ id: 'task-1' } as never)
  })

  it('tells the list owner once about a quiet agent', async () => {
    vi.mocked(prisma.agentListPresence.findMany).mockResolvedValue([
      { id: 'p1', listId: 'l1', agentId: 'a1', lastQueueCheckAt: ago(90), lastHeartbeatAt: null, list: { ownerId: 'owner' } },
    ] as never)
    vi.mocked(prisma.agentListPresence.updateMany).mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 })

    const first = await notifyQuietAgents(now)
    const second = await notifyQuietAgents(now) // an overlapping tick lost the conditional write

    expect(first.notified).toBe(1)
    expect(second.notified).toBe(0)
    expect(persistNotifications).toHaveBeenCalledTimes(1)
    expect(persistNotifications).toHaveBeenCalledWith(expect.objectContaining({
      targets: [{ userId: 'owner', kind: 'agent_quiet' }],
    }))
  })

  it('does not notify while a fresh heartbeat covers a stale queue check', async () => {
    vi.mocked(prisma.agentListPresence.findMany).mockResolvedValue([
      { id: 'p1', listId: 'l1', agentId: 'a1', lastQueueCheckAt: ago(90), lastHeartbeatAt: ago(2), list: { ownerId: 'owner' } },
    ] as never)
    expect((await notifyQuietAgents(now)).notified).toBe(0)
    expect(persistNotifications).not.toHaveBeenCalled()
  })

  it('records a queue check only on boards the caller can read, and clears the quiet mark', async () => {
    vi.mocked(prisma.taskList.findMany).mockResolvedValue([{ id: 'l1' }] as never)
    await recordAgentQueueCheck({ agentId: 'a1', userId: 'u1', listIds: ['l1', 'stranger'], now })
    expect(prisma.agentListPresence.upsert).toHaveBeenCalledTimes(1)
    expect(prisma.agentListPresence.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { listId_agentId: { listId: 'l1', agentId: 'a1' } },
      update: { lastQueueCheckAt: now, quietNotifiedAt: null },
    }))
  })
})
