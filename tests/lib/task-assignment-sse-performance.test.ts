import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sendSSENotification } from '@/lib/webhooks/task-assignment-notifier'
import { broadcastToUsers } from '@/lib/sse-utils'

vi.mock('@/lib/sse-utils', () => ({
  broadcastToUsers: vi.fn(),
}))

describe('task assignment SSE fanout performance', () => {
  const prisma = {
    taskList: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    prisma.taskList.findMany.mockResolvedValue([
      {
        id: 'list-1',
        ownerId: 'owner-1',
        listMembers: [{ userId: 'member-1' }],
      },
      {
        id: 'list-2',
        ownerId: 'owner-2',
        listMembers: [{ userId: 'member-1' }, { userId: 'agent-1' }],
      },
    ])
  })

  it('AWTD-performance loads every list audience in one query', async () => {
    const task = {
      id: 'task-1',
      title: 'Task',
      description: '',
      priority: 1,
      dueDateTime: null,
      assigneeId: 'agent-1',
      creatorId: 'creator-1',
      creator: { id: 'creator-1' },
      lists: [
        { id: 'list-1', name: 'One' },
        { id: 'list-2', name: 'Two' },
      ],
    }
    const payload = {
      event: 'task.assigned',
      aiAgent: { name: 'Agent', type: 'coding_agent' },
    }

    await sendSSENotification(task, payload as never, prisma as never)

    expect(prisma.taskList.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['list-1', 'list-2'] } },
      select: {
        id: true,
        ownerId: true,
        listMembers: { select: { userId: true } },
      },
    })
    expect(prisma.taskList.findUnique).not.toHaveBeenCalled()
    expect(broadcastToUsers).toHaveBeenCalledWith(
      expect.arrayContaining(['creator-1', 'owner-1', 'owner-2', 'member-1']),
      expect.objectContaining({ type: 'ai_agent_assigned' }),
    )
    expect(vi.mocked(broadcastToUsers).mock.calls[0][0]).not.toContain('agent-1')
  })
})
