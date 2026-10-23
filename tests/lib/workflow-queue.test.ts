/**
 * AWTD-1342: lib/workflow-queue.ts had no test.
 *
 * Pinned:
 *   - at most MAX_CONCURRENT_WORKFLOWS (2) run per API key; the next one queues;
 *   - a finished workflow frees its slot and the queue drains into it;
 *   - queues are per API key: one user's full queue never delays another's;
 *   - the per-user token window is a rolling 60s (strictly older entries drop),
 *     it gates immediate execution when < 8000 tokens remain, and the 5s
 *     processor starts a queued workflow once the window has rolled.
 *
 * Note: nothing in app/ calls `enqueue` today; the live surface is
 * recordTokens / getTokensUsedInWindow (lib/ai/clients/claude.ts).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const db = vi.hoisted(() => ({
  task: { findUnique: vi.fn() },
  codingTaskWorkflow: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
}))
const runs = vi.hoisted(() => ({ resolvers: [] as Array<() => void>, started: [] as string[] }))

vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/ai-agent-comment-service', () => ({ createAIAgentComment: vi.fn(async () => undefined) }))
vi.mock('@/lib/ai-orchestrator', () => ({
  AIOrchestrator: {
    createForTaskWithService: vi.fn(async (taskId: string) => ({
      getTraceId: () => 'trace',
      executeCompleteWorkflow: () => {
        runs.started.push(taskId)
        return new Promise<void>(resolve => runs.resolvers.push(resolve))
      },
    })),
  },
}))

type Queue = import('@/lib/workflow-queue').WorkflowQueue

// Captured before any test fakes timers. The queue's lazy `import()`s go through
// vitest's module runner, which answers over RPC — microtasks alone never see them land.
const realSetTimeout = globalThis.setTimeout

/**
 * Each workflow `import()`s the orchestrator lazily. Under vitest 4.1, when two
 * dynamic imports of a vi.mock'ed module are in flight at once only the first
 * gets the mock — the second loads the REAL orchestrator (seen here: the real
 * factory ran for t2). Production has no such race. So a workflow's task lookup
 * waits until every earlier workflow has reached its orchestrator: the slots are
 * still held concurrently, the imports just do not overlap.
 */
let lookups = 0
async function afterEarlierStarts() {
  const earlier = lookups++
  for (let i = 0; i < 500 && runs.started.length < earlier; i++) {
    await new Promise(resolve => realSetTimeout(resolve, 2))
  }
}

async function freshQueue(): Promise<Queue> {
  const { WorkflowQueue } = await import('@/lib/workflow-queue')
  // A fresh singleton per test; its timers are fake, so the old one's die with them.
  Reflect.set(WorkflowQueue, 'instance', undefined)
  return WorkflowQueue.getInstance()
}

/** Let the async workflow bodies (and their dynamic imports) run to their next pending await. */
async function settle() {
  for (let i = 0; i < 10; i++) await new Promise(resolve => realSetTimeout(resolve, 2))
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  runs.resolvers.length = 0
  runs.started.length = 0
  lookups = 0
  db.task.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
    await afterEarlierStarts()
    return { id: where.id, completed: false }
  })
  db.codingTaskWorkflow.findUnique.mockResolvedValue(null)
  db.codingTaskWorkflow.create.mockImplementation(async ({ data }: { data: { taskId: string } }) => ({ id: `wf-${data.taskId}`, metadata: {} }))
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('WorkflowQueue concurrency cap (AWTD-1342)', () => {
  it('runs two workflows per API key at once and queues the third', async () => {
    const queue = await freshQueue()

    expect(await queue.enqueue('t1', 'alice', 'repo')).toEqual({ queued: false })
    expect(await queue.enqueue('t2', 'alice', 'repo')).toEqual({ queued: false })
    const third = await queue.enqueue('t3', 'alice', 'repo')

    expect(third).toMatchObject({ queued: true, position: 1 })
    expect(queue.getStats('alice')).toMatchObject({ activeWorkflows: 2, queueLength: 1 })
    await settle()
    expect(runs.started).toEqual(['t1', 't2'])
  })

  it('a finished workflow frees its slot and the queued one starts', async () => {
    const queue = await freshQueue()
    await queue.enqueue('t1', 'alice', 'repo')
    await queue.enqueue('t2', 'alice', 'repo')
    await queue.enqueue('t3', 'alice', 'repo')
    await settle()

    runs.resolvers[0]()
    await settle()

    expect(runs.started).toEqual(['t1', 't2', 't3'])
    expect(queue.getStats('alice')).toMatchObject({ activeWorkflows: 2, queueLength: 0 })
  })

  it('a task completed while queued releases its slot without running', async () => {
    db.task.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({
      id: where.id,
      completed: where.id === 't1',
    }))
    const queue = await freshQueue()
    await queue.enqueue('t1', 'alice', 'repo')
    await settle()

    expect(runs.started).toEqual([])
    expect(queue.getStats('alice').activeWorkflows).toBe(0)
  })

  it('one API key at capacity does not delay another', async () => {
    const queue = await freshQueue()
    await queue.enqueue('t1', 'alice', 'repo')
    await queue.enqueue('t2', 'alice', 'repo')

    expect(await queue.enqueue('t3', 'bob', 'repo')).toEqual({ queued: false })
    expect(queue.getStats('bob')).toMatchObject({ activeWorkflows: 1, queueLength: 0 })
    expect(queue.getStats()).toMatchObject({ activeWorkflows: 3, queueLength: 0 })
  })
})

describe('WorkflowQueue per-user token window (AWTD-1342)', () => {
  it('is a rolling 60 seconds: an entry exactly 60s old has left the window', async () => {
    const queue = await freshQueue()
    queue.recordTokens('alice', 1000)
    vi.advanceTimersByTime(30_000)
    queue.recordTokens('alice', 500)

    vi.advanceTimersByTime(29_999)
    expect(queue.getTokensUsedInWindow('alice')).toBe(1500)
    vi.advanceTimersByTime(1)
    expect(queue.getTokensUsedInWindow('alice')).toBe(500)
    vi.advanceTimersByTime(30_000)
    expect(queue.getTokensUsedInWindow('alice')).toBe(0)
  })

  it('is per user: one key’s usage never spends another’s budget', async () => {
    const queue = await freshQueue()
    queue.recordTokens('alice', 29_000)

    expect(queue.getTokensUsedInWindow('bob')).toBe(0)
    expect(await queue.enqueue('t1', 'bob', 'repo')).toEqual({ queued: false })
  })

  it('queues when less than one workflow’s estimate (8000) remains, even with free slots', async () => {
    const queue = await freshQueue()
    queue.recordTokens('alice', 22_001) // 7_999 left

    const result = await queue.enqueue('t1', 'alice', 'repo')
    expect(result).toMatchObject({ queued: true, position: 1 })
    expect(queue.getStats('alice')).toMatchObject({ activeWorkflows: 0, tokenBudgetRemaining: 7_999 })
  })

  it('exactly 8000 remaining is enough to start', async () => {
    const queue = await freshQueue()
    queue.recordTokens('alice', 22_000)
    expect(await queue.enqueue('t1', 'alice', 'repo')).toEqual({ queued: false })
  })

  it('a started workflow spends its estimate, so the budget caps starts within a minute', async () => {
    const queue = await freshQueue()
    queue.recordTokens('alice', 8_000)
    await queue.enqueue('t1', 'alice', 'repo')
    await settle()

    expect(queue.getTokensUsedInWindow('alice')).toBe(16_000)
    // 14k left would admit one more, but a second start leaves 6k < 8k.
    await queue.enqueue('t2', 'alice', 'repo')
    await settle()
    runs.resolvers[0]()
    runs.resolvers[1]()
    await settle()
    expect(await queue.enqueue('t3', 'alice', 'repo')).toMatchObject({ queued: true })
  })

  it('the background processor starts a budget-blocked workflow once the window rolls', async () => {
    const queue = await freshQueue()
    queue.recordTokens('alice', 30_000)
    await queue.enqueue('t1', 'alice', 'repo')
    await settle()
    expect(runs.started).toEqual([])

    await vi.advanceTimersByTimeAsync(55_000)
    await settle()
    expect(runs.started).toEqual([])

    await vi.advanceTimersByTimeAsync(5_000) // 60s: window rolled, next 5s tick
    await settle()
    expect(runs.started).toEqual(['t1'])
  })
})
