/**
 * AWTD-1462: the statements an edit pays for BEFORE its response is returned.
 *
 * updateTaskWithSideEffects runs its whole side-effect chain inside the
 * request (finding W4). This pins how many database statements that chain
 * issues on the request path, so moving work off it is measurable and moving
 * work back onto it is a visible failure rather than a slow drift.
 *
 * Every Prisma call is counted through a stand-in client, and every
 * collaborator runs for real except those that leave the process (Redis, SSE,
 * the GitHub backend, the AI-agent notifier). Work deferred with
 * runAfterResponse is held and counted separately: it runs after the
 * response, and its statements are not the request's.
 *
 * The stand-in also keeps the Job table, so the job queue's drain (itself
 * started with runAfterResponse) runs the `task-updated` job for real in the
 * after phase.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const calls = vi.hoisted(() => ({
  request: [] as string[],
  deferredWork: [] as Array<() => Promise<unknown>>,
  phase: 'request' as 'request' | 'after',
  after: [] as string[],
  jobs: [] as Array<{ id: string; kind: string; payload: unknown; attempts: number; dedupeKey: string | null; doneAt: Date | null }>,
  dependents: [] as Array<{ blockedTask: { id: string; statusRole: string | null; completed: boolean } }>,
  notificationArgs: [] as any[],
  /** Replaces notification.createMany when set. */
  notificationWrite: null as null | (() => Promise<unknown>),
}))

const fixture = vi.hoisted(() => {
  const now = new Date('2026-11-01T12:00:00.000Z')
  return {
    task: {
      id: 'task-1',
      title: 'Old title',
      description: '',
      priority: 0,
      completed: false,
      completedAt: null,
      closedReason: null,
      isPrivate: false,
      repeating: 'never',
      repeatingData: null,
      repeatFrom: 'COMPLETION_DATE',
      occurrenceCount: 0,
      dueDateTime: null,
      isAllDay: false,
      reminderTime: null,
      reminderSent: false,
      reminderType: null,
      assigneeId: 'user-2',
      assigneeIds: ['user-2'],
      assignee: { id: 'user-2', name: 'Bo', email: 'bo@example.com', isAIAgent: false },
      creatorId: 'user-1',
      creator: { id: 'user-1', name: 'Jon', email: 'jon@example.com' },
      statusRole: null,
      identifier: 'AWTD-1',
      parentTaskId: null,
      lists: [{ id: 'list-1', name: 'L', ownerId: 'user-1', listMembers: [{ userId: 'user-1', role: 'admin' }, { userId: 'user-2', role: 'member' }] }],
      comments: [],
      attachments: [],
      secureFiles: [],
      createdAt: now,
      updatedAt: now,
    } as Record<string, unknown>,
  }
})

function counting(model: string, method: string, args: unknown): unknown {
  ;(calls.phase === 'request' ? calls.request : calls.after).push(`${model}.${method}`)
  if (model === 'job') return jobTable(method, args)
  if (model === 'taskDependency' && method === 'findMany') return calls.dependents
  if (model === 'notification' && method === 'createMany') {
    calls.notificationArgs.push(args)
    if (calls.notificationWrite) return calls.notificationWrite()
  }
  if (model === 'task' && (method === 'findUnique' || method === 'findFirst')) return { ...fixture.task }
  if (model === 'task' && method === 'update') {
    const data = (args as { data: Record<string, unknown> }).data
    return { ...fixture.task, ...Object.fromEntries(Object.entries(data).filter(([k]) => k !== 'lists')) }
  }
  if (method === 'findMany') return []
  if (method === 'count') return 0
  if (method === 'createMany' || method === 'updateMany' || method === 'deleteMany') return { count: 0 }
  if (method === 'findUnique' || method === 'findFirst') return null
  return {}
}

function jobTable(method: string, args: any): unknown {
  if (method === 'createMany') {
    let count = 0
    for (const row of args.data) {
      if (row.dedupeKey && calls.jobs.some(job => job.dedupeKey === row.dedupeKey)) continue
      calls.jobs.push({ id: `job-${calls.jobs.length + 1}`, kind: row.kind, payload: JSON.parse(JSON.stringify(row.payload)), attempts: 0, dedupeKey: row.dedupeKey, doneAt: null })
      count++
    }
    return { count }
  }
  if (method === 'findMany') return calls.jobs.filter(job => !job.doneAt).map(({ id, kind, payload, attempts }) => ({ id, kind, payload, attempts }))
  if (method === 'updateMany') return { count: 1 }
  if (method === 'update') {
    const job = calls.jobs.find(j => j.id === args.where.id)
    if (job && args.data.doneAt) job.doneAt = args.data.doneAt
    return {}
  }
  return { count: 0 }
}

const prismaProxy = vi.hoisted(() => {
  const handler: ProxyHandler<object> = {
    get(_t, model: string) {
      if (model === '$transaction')
        return async (arg: unknown) => (typeof arg === 'function' ? (arg as (c: unknown) => unknown)(proxy) : Promise.all(arg as unknown[]))
      if (model === 'then') return undefined
      return new Proxy({}, { get: (_m, method: string) => async (args: unknown) => counting(model, method, args) })
    },
  }
  const proxy: Record<string, unknown> = new Proxy({}, handler) as Record<string, unknown>
  return proxy
})
vi.mock('@/lib/prisma', () => ({ prisma: prismaProxy }))

vi.mock('@/lib/background', () => ({
  runAfterResponse: (_label: string, work: () => Promise<unknown>) => calls.deferredWork.push(work),
}))
vi.mock('@/lib/redis', () => ({
  RedisCache: { invalidate: { userTasks: vi.fn() }, get: vi.fn(), set: vi.fn(), del: vi.fn() },
  isRedisAvailable: vi.fn(async () => false),
}))
vi.mock('@/lib/sse-utils', () => ({ broadcastToUsers: vi.fn() }))
vi.mock('@/lib/ai-agent-webhook-service', () => ({ aiAgentWebhookService: { notifyTaskAssignment: vi.fn() } }))

import { updateTaskWithSideEffects } from '@/services/task.service'

beforeEach(() => {
  calls.request.length = 0
  calls.after.length = 0
  calls.deferredWork.length = 0
  calls.jobs.length = 0
  calls.dependents.length = 0
  calls.notificationWrite = null
  calls.notificationArgs.length = 0
  calls.phase = 'request'
})

async function edit(intent: Record<string, unknown>) {
  const result = await updateTaskWithSideEffects({ taskId: 'task-1', actorId: 'user-1', actorName: 'Jon', intent: intent as never })
  expect(result.ok).toBe(true)
  const request = [...calls.request]
  calls.phase = 'after'
  await runDeferredWork()
  return { request, after: [...calls.after] }
}

async function runDeferredWork() {
  // Deferred work can defer more (a drain started by an enqueue).
  while (calls.deferredWork.length > 0) await calls.deferredWork.shift()!()
}

/**
 * Step 1 measured a title edit at 6 statements on the request path and a
 * completion at 13 (each includes the read of the existing task and the row
 * update). Analytics was one and two of them, and moved to after().
 *
 * Step 2 (Jon's decision (b), 2026-11-01): reminders, the dependents re-check,
 * notifications and the stats reset became one `task-updated` job. A
 * completion with a dependent and someone to notify was 12. It is now 8: the
 * four (or more, with more dependents) become one job insert. A title edit
 * that notifies nobody writes no job and stays at 5.
 */
const TITLE_EDIT_BUDGET = 5
const COMPLETION_BUDGET = 8

describe('task update query budget (AWTD-1462)', () => {
  it(`a title edit issues at most ${TITLE_EDIT_BUDGET} statements before responding`, async () => {
    const { request, after } = await edit({ title: 'New title' })
    expect(request.length, request.join('\n')).toBeLessThanOrEqual(TITLE_EDIT_BUDGET)
    // Analytics still happens, just not on the response's clock.
    expect(request).not.toContain('analyticsEvent.create')
    expect(after).toContain('analyticsEvent.create')
  })

  it(`a completion issues at most ${COMPLETION_BUDGET} statements before responding`, async () => {
    const { request, after } = await edit({ completed: true })
    expect(request.length, request.join('\n')).toBeLessThanOrEqual(COMPLETION_BUDGET)
    expect(after.filter(c => c === 'analyticsEvent.create')).toHaveLength(2) // TASK_COMPLETED + TASK_EDITED
  })

  it(`AWTD-1462: a completion with a dependent and someone to notify issues at most ${COMPLETION_BUDGET} statements before responding`, async () => {
    calls.dependents.push({ blockedTask: { id: 'task-2', statusRole: 'waiting', completed: false } })
    const { request, after } = await edit({ completed: true })

    expect(request.length, request.join('\n')).toBeLessThanOrEqual(COMPLETION_BUDGET)
    // None of the four runs on the response's clock any more…
    for (const deferred of ['reminderQueue.updateMany', 'taskDependency.findMany', 'notification.createMany', 'user.updateMany']) {
      expect(request, deferred).not.toContain(deferred)
    }
    // …one job carries them…
    expect(request.filter(c => c === 'job.createMany')).toHaveLength(1)
    // …and every one of them still happens, after the response.
    for (const deferred of ['reminderQueue.updateMany', 'taskDependency.findMany', 'notification.createMany', 'user.updateMany']) {
      expect(after, deferred).toContain(deferred)
    }
    expect(calls.jobs.map(job => [job.kind, Boolean(job.doneAt)])).toEqual([['task-updated', true]])
  })

  it('AWTD-1462: a title edit that notifies nobody writes no job', async () => {
    const { request } = await edit({ title: 'New title' })
    expect(request).not.toContain('job.createMany')
  })

  it('AWTD-1462: a failing notification neither fails nor delays the response, and the other effects still run', async () => {
    let fail!: (err: Error) => void
    let attempted = false
    calls.notificationWrite = () => {
      attempted = true
      return new Promise((_resolve, reject) => { fail = reject })
    }

    const result = await updateTaskWithSideEffects({ taskId: 'task-1', actorId: 'user-1', actorName: 'Jon', intent: { completed: true } as never })
    // The response came back while the notification write had not even started.
    expect(result.ok).toBe(true)
    expect(attempted).toBe(false)

    calls.phase = 'after'
    const drained = runDeferredWork()
    await vi.waitFor(() => expect(attempted).toBe(true))
    fail(new Error('notification store down'))
    await drained

    // Stats come after notifications in the job; they still ran.
    expect(calls.after).toContain('user.updateMany')
    // The job finished (the failure is logged, as it was in the request).
    expect(calls.jobs.map(job => Boolean(job.doneAt))).toEqual([true])
  })

  it('AWTD-1462: a re-run of the same job cannot notify twice', async () => {
    await edit({ completed: true })
    const { runTaskUpdatedJob } = await import('@/services/task-update-deferred-effects')
    // A drainer killed after the notifications were written runs the job again.
    await runTaskUpdatedJob(calls.jobs[0].payload as never)

    expect(calls.notificationArgs).toHaveLength(2)
    const [first, rerun] = calls.notificationArgs
    expect(first.skipDuplicates).toBe(true)
    expect(rerun.skipDuplicates).toBe(true)
    // Same rows, same ids: the second insert skips every one of them.
    expect(first.data.length).toBeGreaterThan(0)
    expect(rerun.data.map((row: any) => row.id)).toEqual(first.data.map((row: any) => row.id))
  })
})
