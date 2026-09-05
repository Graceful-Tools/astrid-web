/**
 * RED for task a7394c89.
 *
 * The scheduler de-duplicated dispatches in a module-level Set, with a comment
 * claiming "the DB check is the source of truth" — there is no DB check in that
 * file. The dispatch window is 30-60 minutes and the cron runs every minute, so
 * each due task is seen by about thirty consecutive runs. On a warm serverless
 * fleet a per-instance Set means one dispatch PER INSTANCE, and every duplicate
 * is a real agent run and real model spend.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const claimOnce = vi.hoisted(() => vi.fn())
const isRedisAvailable = vi.hoisted(() => vi.fn())
const findMany = vi.hoisted(() => vi.fn())
const broadcastToUsers = vi.hoisted(() => vi.fn())
const resolveDefaultAgent = vi.hoisted(() => vi.fn())

vi.mock('@/lib/redis', () => ({
  RedisCache: { claimOnce },
  isRedisAvailable,
}))
vi.mock('@/lib/prisma', () => ({ prisma: { task: { findMany } } }))
vi.mock('@/lib/sse-utils', () => ({ broadcastToUsers }))
vi.mock('@/lib/resolve-default-agent', () => ({ resolveDefaultAgent }))

const { processAgentTasksDueSoon } = await import('@/lib/agent-task-scheduler')

function dueTask(id: string) {
  return {
    id,
    title: `Task ${id}`,
    description: null,
    dueDateTime: new Date(),
    assigneeId: 'agent-1',
    creatorId: 'u1',
    assignee: { id: 'agent-1', isAIAgent: true, email: 'claude@astrid.cc' },
    lists: [{ id: 'l1', ownerId: 'u1' }],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  isRedisAvailable.mockResolvedValue(true)
  broadcastToUsers.mockResolvedValue(undefined)
})

describe('processAgentTasksDueSoon', () => {
  it('takes a shared claim rather than trusting local memory', async () => {
    findMany.mockResolvedValue([dueTask('t-shared-1')])
    claimOnce.mockResolvedValue(true)

    await processAgentTasksDueSoon()

    expect(claimOnce).toHaveBeenCalledWith('agent-dispatch:t-shared-1', expect.any(Number))
    expect(broadcastToUsers).toHaveBeenCalledTimes(1)
  })

  it('does not dispatch when another instance already holds the claim', async () => {
    findMany.mockResolvedValue([dueTask('t-taken-1')])
    claimOnce.mockResolvedValue(false)

    const dispatched = await processAgentTasksDueSoon()

    expect(dispatched).toBe(0)
    expect(broadcastToUsers).not.toHaveBeenCalled()
  })

  it('claims for long enough to cover the whole dispatch window', async () => {
    findMany.mockResolvedValue([dueTask('t-ttl-1')])
    claimOnce.mockResolvedValue(true)

    await processAgentTasksDueSoon()

    const ttl = claimOnce.mock.calls[0][1] as number
    // The window is 30-60 minutes and the cron runs every minute.
    expect(ttl).toBeGreaterThanOrEqual(60 * 60)
  })

  it('still dispatches once when Redis is unavailable, rather than never', async () => {
    findMany.mockResolvedValue([dueTask('t-degraded-1')])
    claimOnce.mockResolvedValue(false)
    isRedisAvailable.mockResolvedValue(false)

    const dispatched = await processAgentTasksDueSoon()

    expect(dispatched).toBe(1)
  })
})
