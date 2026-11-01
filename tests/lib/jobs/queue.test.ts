/**
 * AWTD-1460: the durable Job queue.
 *
 *   - a job enqueued on one instance is completed by a drain on another —
 *     nothing about it lives in process memory;
 *   - two drainers that read the same row: exactly one runs it;
 *   - a handler that throws is retried with backoff, then dead-lettered;
 *   - an expired lock (a drainer killed mid-run) lets the next drain re-run it;
 *   - a duplicate dedupeKey is a no-op;
 *   - an enqueue that cannot reach the database still runs the work, in after().
 *
 * The table is an in-memory stand-in with the same conditional-update
 * semantics as Postgres, shared by every "instance" (a fresh module graph).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

interface Row {
  id: string
  kind: string
  dedupeKey: string | null
  payload: unknown
  attempts: number
  runAfter: Date
  lockedUntil: Date | null
  doneAt: Date | null
  deadAt: Date | null
  lastError: string | null
  createdAt: Date
}

const table = vi.hoisted(() => ({ rows: [] as Row[], seq: 0, failInsert: false }))

type Where = Record<string, unknown>
function matches(row: Row, where: Where): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as Where[]).some(w => matches(row, w))
    const value = (row as unknown as Record<string, unknown>)[key]
    if (cond === null) return value === null
    if (cond instanceof Date || typeof cond !== 'object') return value === cond
    const c = cond as { lt?: Date; lte?: Date }
    if (!(value instanceof Date)) return false
    if (c.lt && !(value < c.lt)) return false
    if (c.lte && !(value <= c.lte)) return false
    return true
  })
}
function apply(row: Row, data: Record<string, unknown>) {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && 'increment' in (value as object)) {
      ;(row as unknown as Record<string, number>)[key] += (value as { increment: number }).increment
    } else (row as unknown as Record<string, unknown>)[key] = value
  }
}

const db = vi.hoisted(() => ({
  job: {
    createMany: vi.fn(async ({ data }: { data: Array<Partial<Row>> }) => {
      if (table.failInsert) throw new Error('relation "Job" does not exist')
      let count = 0
      for (const d of data) {
        if (d.dedupeKey && table.rows.some(r => r.dedupeKey === d.dedupeKey)) continue
        table.rows.push({
          id: `job-${++table.seq}`,
          kind: d.kind!,
          dedupeKey: d.dedupeKey ?? null,
          payload: d.payload,
          attempts: 0,
          runAfter: d.runAfter ?? new Date(NOW_MS),
          lockedUntil: null,
          doneAt: null,
          deadAt: null,
          lastError: null,
          createdAt: new Date(NOW_MS),
        })
        count++
      }
      return { count }
    }),
    findMany: vi.fn(async ({ where, take }: { where: Where; take: number }) =>
      table.rows
        .filter(r => matches(r, where))
        .sort((a, b) => a.runAfter.getTime() - b.runAfter.getTime())
        .slice(0, take)
        .map(r => ({ id: r.id, kind: r.kind, payload: r.payload, attempts: r.attempts })),
    ),
    updateMany: vi.fn(async ({ where, data }: { where: Where; data: Record<string, unknown> }) => {
      const hit = table.rows.filter(r => matches(r, where))
      hit.forEach(r => apply(r, data))
      return { count: hit.length }
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = table.rows.find(r => r.id === where.id)!
      apply(row, data)
      return row
    }),
    deleteMany: vi.fn(async ({ where }: { where: Where }) => {
      const before = table.rows.length
      table.rows = table.rows.filter(r => !matches(r, where))
      return { count: before - table.rows.length }
    }),
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const deferred = vi.hoisted(() => [] as Array<{ label: string; work: () => Promise<unknown> }>)
vi.mock('@/lib/background', () => ({
  runAfterResponse: (label: string, work: () => Promise<unknown>) => deferred.push({ label, work }),
}))

const runtime = vi.hoisted(() => ({ processAstridMessage: vi.fn(async () => undefined), processAstridComment: vi.fn(async () => undefined) }))
vi.mock('@/lib/astrid-agent-runtime', () => runtime)

const NOW_MS = vi.hoisted(() => Date.parse('2026-11-01T12:00:00.000Z'))

type QueueModule = typeof import('@/lib/jobs/queue')
/** A fresh module graph is a fresh instance: no state carried over but the table. */
async function instance(): Promise<QueueModule> {
  vi.resetModules()
  return import('@/lib/jobs/queue')
}

const handoff = {
  userMessage: 'what should I do today?',
  userId: 'user-1',
  userName: 'Jon',
  channelId: 'channel-1',
  listId: 'list-1',
  replyClientRequestId: 'astrid-reply:msg-1',
}

beforeEach(() => {
  vi.clearAllMocks()
  table.rows = []
  table.seq = 0
  table.failInsert = false
  deferred.length = 0
})

describe('durable job queue (AWTD-1460)', () => {
  it('a job enqueued on one instance is completed by a drain on another', async () => {
    const a = await instance()
    expect(await a.enqueueJob('astrid-handoff', handoff, { drain: false })).toBe('queued')

    const b = await instance()
    expect(b).not.toBe(a)
    const summary = await b.drainJobs({ now: () => new Date(NOW_MS) })

    expect(summary).toEqual({ claimed: 1, succeeded: 1, failed: 0, dead: 0 })
    expect(runtime.processAstridMessage).toHaveBeenCalledWith(handoff)
    expect(table.rows[0].doneAt).not.toBeNull()
    expect(table.rows[0].deadAt).toBeNull()
  })

  it('starts a drain after the response when it enqueues', async () => {
    const q = await instance()
    await q.enqueueJob('astrid-handoff', handoff)
    expect(deferred.map(d => d.label)).toEqual(['jobs-drain'])

    await deferred[0].work()
    expect(runtime.processAstridMessage).toHaveBeenCalledTimes(1)
  })

  it('runs a job once when two drainers race for it', async () => {
    const q = await instance()
    await q.enqueueJob('astrid-comment-reply', { commentContent: 'hi @Astrid', userId: 'u', userName: 'U', taskId: 't', taskTitle: 'T', listId: null }, { drain: false })

    let release!: () => void
    runtime.processAstridComment.mockImplementationOnce(() => new Promise<undefined>(r => { release = () => r(undefined) }))
    const first = q.drainJobs({ now: () => new Date(NOW_MS) })
    await vi.waitFor(() => expect(runtime.processAstridComment).toHaveBeenCalledTimes(1))
    const second = await (await instance()).drainJobs({ now: () => new Date(NOW_MS) })
    release()

    expect((await first).succeeded).toBe(1)
    expect(second.claimed).toBe(0)
    expect(runtime.processAstridComment).toHaveBeenCalledTimes(1)
  })

  it('retries a handler that throws with backoff, then dead-letters it', async () => {
    const q = await instance()
    await q.enqueueJob('astrid-handoff', handoff, { drain: false })
    const boom = vi.fn(async () => {
      throw new Error('model exploded')
    })
    const { JOB_POLICIES, backoffMs } = await import('@/lib/jobs/kinds')
    const max = JOB_POLICIES['astrid-handoff'].maxAttempts

    let t = NOW_MS
    const delays: number[] = []
    for (let attempt = 1; attempt <= max; attempt++) {
      const summary = await q.drainJobs({ now: () => new Date(t), handlers: { 'astrid-handoff': boom } })
      expect(summary.claimed).toBe(1)
      const row = table.rows[0]
      expect(row.lastError).toBe('model exploded')
      expect(row.attempts).toBe(attempt)
      if (attempt < max) {
        expect(row.doneAt).toBeNull()
        delays.push(row.runAfter.getTime() - t)
        // Not due again until the backoff has passed.
        expect((await q.drainJobs({ now: () => new Date(t + 1), handlers: { 'astrid-handoff': boom } })).claimed).toBe(0)
        t = row.runAfter.getTime()
      } else {
        expect(summary.dead).toBe(1)
        expect(row.deadAt).not.toBeNull()
        expect(row.doneAt).not.toBeNull()
      }
    }
    expect(delays).toEqual(Array.from({ length: max - 1 }, (_, i) => backoffMs('astrid-handoff', i + 1)))
    expect(delays[1]).toBeGreaterThan(delays[0])

    // Dead is final: nothing drains it again.
    expect((await q.drainJobs({ now: () => new Date(t + 86_400_000), handlers: { 'astrid-handoff': boom } })).claimed).toBe(0)
    expect(boom).toHaveBeenCalledTimes(max)
  })

  it('re-runs a job whose drainer died holding the lock, once the lock expires', async () => {
    const q = await instance()
    await q.enqueueJob('astrid-handoff', handoff, { drain: false })
    // A drainer claimed it and was frozen: locked, attempt spent, never finished.
    const { JOB_POLICIES } = await import('@/lib/jobs/kinds')
    table.rows[0].attempts = 1
    table.rows[0].lockedUntil = new Date(NOW_MS + JOB_POLICIES['astrid-handoff'].lockMs)

    expect((await q.drainJobs({ now: () => new Date(NOW_MS + 60_000) })).claimed).toBe(0)
    const later = await q.drainJobs({ now: () => new Date(NOW_MS + JOB_POLICIES['astrid-handoff'].lockMs + 1) })
    expect(later.succeeded).toBe(1)
    expect(runtime.processAstridMessage).toHaveBeenCalledTimes(1)
  })

  it('treats a second enqueue with the same dedupeKey as a no-op', async () => {
    const q = await instance()
    expect(await q.enqueueJob('astrid-handoff', handoff, { dedupeKey: 'astrid-handoff:msg-1', drain: false })).toBe('queued')
    expect(await q.enqueueJob('astrid-handoff', handoff, { dedupeKey: 'astrid-handoff:msg-1', drain: false })).toBe('duplicate')
    expect(table.rows).toHaveLength(1)
  })

  it('still runs the work, after the response, when the row cannot be written', async () => {
    table.failInsert = true
    const q = await instance()
    expect(await q.enqueueJob('astrid-handoff', handoff)).toBe('inline')
    expect(deferred.map(d => d.label)).toEqual(['job:astrid-handoff'])

    await deferred[0].work()
    expect(runtime.processAstridMessage).toHaveBeenCalledWith(handoff)
  })

  it('dead-letters a kind it has no handler for instead of retrying forever', async () => {
    const q = await instance()
    table.rows.push({ ...structuredClone({ id: 'job-x', kind: 'from-the-future', dedupeKey: null, payload: {}, attempts: 0, lastError: null }), runAfter: new Date(NOW_MS), lockedUntil: null, doneAt: null, deadAt: null, createdAt: new Date(NOW_MS) })
    const { DEFAULT_POLICY } = await import('@/lib/jobs/kinds')
    let t = NOW_MS
    for (let i = 0; i < DEFAULT_POLICY.maxAttempts; i++) {
      await q.drainJobs({ now: () => new Date(t) })
      t = Math.max(t, table.rows[0].runAfter.getTime())
    }
    expect(table.rows[0].deadAt).not.toBeNull()
    expect(table.rows[0].lastError).toMatch(/No handler/)
  })

  it('purges finished jobs past retention and keeps the dead longer', async () => {
    const q = await instance()
    const day = 86_400_000
    const base = { kind: 'astrid-handoff', dedupeKey: null, payload: {}, attempts: 1, runAfter: new Date(0), lockedUntil: null, lastError: null, createdAt: new Date(0) }
    table.rows.push(
      { ...base, id: 'old-done', doneAt: new Date(NOW_MS - 8 * day), deadAt: null },
      { ...base, id: 'new-done', doneAt: new Date(NOW_MS - 1 * day), deadAt: null },
      { ...base, id: 'dead-8d', doneAt: new Date(NOW_MS - 8 * day), deadAt: new Date(NOW_MS - 8 * day) },
      { ...base, id: 'dead-31d', doneAt: new Date(NOW_MS - 31 * day), deadAt: new Date(NOW_MS - 31 * day) },
      { ...base, id: 'pending', doneAt: null, deadAt: null },
    )
    expect(await q.purgeFinishedJobs(new Date(NOW_MS))).toBe(2)
    expect(table.rows.map(r => r.id).sort()).toEqual(['dead-8d', 'new-done', 'pending'])
  })
})
