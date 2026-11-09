import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      updateManyAndReturn: vi.fn(),
    },
  },
}))

import { claimAgentTask } from '@/services/agent-task-claim.service'
import { prisma } from '@/lib/prisma'

const TASK_ID = '11111111-1111-4111-8111-111111111111'
const readyTask = {
  id: TASK_ID,
  statusRole: 'ready',
  completed: false,
  assigneeId: null,
  assigneeIds: [],
  updatedAt: new Date('2026-11-08T10:00:00.000Z'),
}
const doingTask = {
  ...readyTask,
  statusRole: 'doing',
  assigneeId: 'codex-1',
  assigneeIds: ['codex-1'],
}

describe('agent task claim atomicity (AWTD-1555)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.task.findFirst).mockResolvedValue(readyTask as never)
  })

  it('lets exactly one of ten simultaneous claims win, with all others conflicting', async () => {
    vi.mocked(prisma.task.findFirst).mockReset()
    for (let i = 0; i < 10; i += 1) {
      vi.mocked(prisma.task.findFirst).mockResolvedValueOnce(readyTask as never)
    }
    for (let i = 0; i < 9; i += 1) {
      vi.mocked(prisma.task.findFirst).mockResolvedValueOnce(doingTask as never)
    }
    vi.mocked(prisma.task.updateManyAndReturn)
      .mockResolvedValueOnce([doingTask] as never)
      .mockResolvedValue([] as never)

    const results = await Promise.all(
      Array.from({ length: 10 }, () => claimAgentTask({
        taskId: TASK_ID,
        userId: 'owner-1',
        agentId: 'codex-1',
        action: 'claim',
      })),
    )

    expect(results.filter(result => result.outcome === 'claimed')).toHaveLength(1)
    expect(results.filter(result => result.outcome === 'conflict')).toHaveLength(9)
    expect(prisma.task.updateManyAndReturn).toHaveBeenCalledTimes(10)
    for (const [args] of vi.mocked(prisma.task.updateManyAndReturn).mock.calls) {
      expect(args.where).toMatchObject({
        statusRole: 'ready',
        completed: false,
      })
    }
  })
})
