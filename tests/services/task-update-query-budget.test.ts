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
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const calls = vi.hoisted(() => ({ request: [] as string[], deferredWork: [] as Array<() => Promise<unknown>>, phase: 'request' as 'request' | 'after' , after: [] as string[] }))

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
  calls.phase = 'request'
})

async function edit(intent: Record<string, unknown>) {
  const result = await updateTaskWithSideEffects({ taskId: 'task-1', actorId: 'user-1', actorName: 'Jon', intent: intent as never })
  expect(result.ok).toBe(true)
  const request = [...calls.request]
  calls.phase = 'after'
  for (const work of calls.deferredWork) await work()
  return { request, after: [...calls.after] }
}

/**
 * Measured before this change: a title edit cost 6 statements on the request
 * path, a completion 13 (each includes the read of the existing task and the
 * row update). Analytics was one and two of them. See the Stage 0 matrix on
 * AWTD-1462 for what the rest are and which can move next.
 */
const TITLE_EDIT_BUDGET = 5
const COMPLETION_BUDGET = 11

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
})
