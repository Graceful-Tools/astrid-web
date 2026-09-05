import { describe, expect, it, vi } from 'vitest'

import {
  decideAgentLifecycleTransition,
  reconcileAgentLifecycleTask,
  reconcileAgentLifecycleAfterTaskMutation,
  type AgentLifecycleTaskSnapshot,
} from '@/lib/agent-lifecycle'

const NOW = new Date('2026-09-04T12:00:00.000Z')

function snapshot(
  overrides: Partial<AgentLifecycleTaskSnapshot> = {},
): AgentLifecycleTaskSnapshot {
  return {
    id: 'task-1',
    completed: false,
    statusRole: 'ready',
    dueDateTime: null,
    assigneeId: null,
    assignee: null,
    lists: [{ id: 'board-1', listType: 'regular', agentLifecycleEnabled: true }],
    comments: [],
    ...overrides,
  }
}

describe('agent lifecycle decisions (AWTD-760)', () => {
  it('parks future Ready work only on an opted-in board', () => {
    expect(
      decideAgentLifecycleTransition(
        snapshot({ dueDateTime: new Date('2026-09-05T12:00:00.000Z') }),
        NOW,
      ),
    ).toMatchObject({ from: 'ready', to: 'waiting' })

    expect(
      decideAgentLifecycleTransition(
        snapshot({
          dueDateTime: new Date('2026-09-05T12:00:00.000Z'),
          lists: [{ id: 'board-1', listType: 'regular', agentLifecycleEnabled: false }],
        }),
        NOW,
      ),
    ).toBeNull()
  })

  it('does not move tasks with mixed opted-in and opted-out board membership', () => {
    expect(
      decideAgentLifecycleTransition(
        snapshot({
          dueDateTime: new Date('2026-09-05T12:00:00.000Z'),
          lists: [
            { id: 'board-1', listType: 'regular', agentLifecycleEnabled: true },
            { id: 'board-2', listType: 'regular', agentLifecycleEnabled: false },
            { id: 'ready-column', listType: 'status', agentLifecycleEnabled: false },
          ],
        }),
        NOW,
      ),
    ).toBeNull()
  })

  it('never moves Doing, completed, or human-assigned tasks', () => {
    expect(decideAgentLifecycleTransition(snapshot({ statusRole: 'doing' }), NOW)).toBeNull()
    expect(decideAgentLifecycleTransition(snapshot({ completed: true }), NOW)).toBeNull()
    expect(
      decideAgentLifecycleTransition(
        snapshot({
          assigneeId: 'human-1',
          assignee: { isAIAgent: false },
          dueDateTime: new Date('2026-09-05T12:00:00.000Z'),
        }),
        NOW,
      ),
    ).toBeNull()
  })

  it('promotes due Waiting work but leaves external conditions for agent review', () => {
    expect(
      decideAgentLifecycleTransition(
        snapshot({
          statusRole: 'waiting',
          dueDateTime: new Date('2026-09-04T11:00:00.000Z'),
        }),
        NOW,
      ),
    ).toMatchObject({ from: 'waiting', to: 'ready' })

    expect(
      decideAgentLifecycleTransition(
        snapshot({
          statusRole: 'waiting',
          dueDateTime: new Date('2026-09-04T11:00:00.000Z'),
          comments: [{
            content: 'BLOCKED-ON: vendor release',
            createdAt: new Date('2026-09-04T10:00:00.000Z'),
          }],
        }),
        NOW,
      ),
    ).toBeNull()
  })

  it('uses only the latest marker-bearing comment when evaluating blockers', () => {
    expect(
      decideAgentLifecycleTransition(
        snapshot({
          statusRole: 'waiting',
          comments: [
            {
              content: 'BLOCKED-ON: obsolete external condition',
              createdAt: new Date('2026-09-04T09:00:00.000Z'),
            },
            {
              content: 'BLOCKED-BY: blocker-1',
              createdAt: new Date('2026-09-04T10:00:00.000Z'),
            },
          ],
          openBlockerIds: [],
        }),
        NOW,
      ),
    ).toMatchObject({ from: 'waiting', to: 'ready' })
  })
})

describe('agent lifecycle reconciliation (AWTD-760)', () => {
  it('creates one transition, event, and comment across repeated reconciliation', async () => {
    const task = snapshot({
      dueDateTime: new Date('2026-09-05T12:00:00.000Z'),
    })
    const updateMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
    const taskEventCreate = vi.fn().mockResolvedValue({ id: 'event-1' })
    const commentCreate = vi.fn().mockResolvedValue({ id: 'comment-1' })
    const transaction = vi.fn(async (callback: (tx: unknown) => unknown) =>
      callback({
        task: {
          findUnique: vi.fn().mockResolvedValue(task),
          findMany: vi.fn().mockResolvedValue([]),
          updateMany,
        },
        taskEvent: { create: taskEventCreate },
        comment: { create: commentCreate },
      }),
    )

    const client = { $transaction: transaction } as never
    const first = await reconcileAgentLifecycleTask('task-1', { client, now: NOW })
    const second = await reconcileAgentLifecycleTask('task-1', { client, now: NOW })

    expect(first.outcome).toBe('transitioned')
    expect(second.outcome).toBe('unchanged')
    expect(taskEventCreate).toHaveBeenCalledTimes(1)
    expect(commentCreate).toHaveBeenCalledTimes(1)
  })

  it('creates one transition and one audit pair across concurrent reconciliation', async () => {
    const task = snapshot({
      dueDateTime: new Date('2026-09-05T12:00:00.000Z'),
    })
    let won = false
    const updateMany = vi.fn(async () => {
      if (won) return { count: 0 }
      won = true
      return { count: 1 }
    })
    const taskEventCreate = vi.fn().mockResolvedValue({ id: 'event-1' })
    const commentCreate = vi.fn().mockResolvedValue({ id: 'comment-1' })
    const client = {
      $transaction: vi.fn(async (callback: (tx: unknown) => unknown) =>
        callback({
          task: {
            findUnique: vi.fn().mockResolvedValue(task),
            findMany: vi.fn().mockResolvedValue([]),
            updateMany,
          },
          taskEvent: { create: taskEventCreate },
          comment: { create: commentCreate },
        }),
      ),
    } as never

    const results = await Promise.all([
      reconcileAgentLifecycleTask('task-1', { client, now: NOW }),
      reconcileAgentLifecycleTask('task-1', { client, now: NOW }),
    ])

    expect(results.filter(result => result.outcome === 'transitioned')).toHaveLength(1)
    expect(taskEventCreate).toHaveBeenCalledTimes(1)
    expect(commentCreate).toHaveBeenCalledTimes(1)
  })

  it('rejects the reconciliation when an audit write fails', async () => {
    const task = snapshot({
      dueDateTime: new Date('2026-09-05T12:00:00.000Z'),
    })
    const client = {
      $transaction: vi.fn(async (callback: (tx: unknown) => unknown) =>
        callback({
          task: {
            findUnique: vi.fn().mockResolvedValue(task),
            findMany: vi.fn().mockResolvedValue([]),
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
          taskEvent: { create: vi.fn().mockResolvedValue({ id: 'event-1' }) },
          comment: { create: vi.fn().mockRejectedValue(new Error('audit unavailable')) },
        }),
      ),
    } as never

    await expect(
      reconcileAgentLifecycleTask('task-1', { client, now: NOW }),
    ).rejects.toThrow('audit unavailable')
  })

  it('reconciles Waiting dependents after blocker completion', async () => {
    const completed = snapshot({
      id: 'blocker-1',
      completed: true,
      statusRole: null,
    })
    const dependent = snapshot({
      id: 'dependent-1',
      statusRole: 'waiting',
      comments: [{
        content: 'BLOCKED-BY: blocker-1',
        createdAt: new Date('2026-09-04T10:00:00.000Z'),
      }],
    })
    const taskEventCreate = vi.fn().mockResolvedValue({ id: 'event-1' })
    const commentCreate = vi.fn().mockResolvedValue({ id: 'comment-1' })
    const client = {
      $transaction: vi.fn(async (callback: (tx: unknown) => unknown) =>
        callback({
          task: {
            findUnique: vi.fn(({ where }: { where: { id: string } }) =>
              Promise.resolve(where.id === 'blocker-1' ? completed : dependent),
            ),
            findMany: vi.fn().mockResolvedValue([{ id: 'blocker-1', completed: true }]),
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
          taskEvent: { create: taskEventCreate },
          comment: { create: commentCreate },
        }),
      ),
      comment: {
        findMany: vi.fn().mockResolvedValue([{ taskId: 'dependent-1' }]),
      },
    } as never

    const result = await reconcileAgentLifecycleAfterTaskMutation('blocker-1', {
      client,
      completed: true,
      now: NOW,
    })

    expect(result).toEqual({ scanned: 2, transitioned: 1, unchanged: 1 })
    expect(taskEventCreate).toHaveBeenCalledTimes(1)
    expect(commentCreate).toHaveBeenCalledTimes(1)
  })
})
