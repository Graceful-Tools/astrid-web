/**
 * Route tests for four write/read routes no test referenced (ADEV-293):
 * POST /tasks/:id/handoff, POST /tasks/:id/cost, GET /lists/:id/agents and
 * PUT /projects/:id/goals/:goalId/measure. Each runs the REAL route through the
 * real withAuth wrapper: unauthenticated -> 401, no access -> 403/404, the
 * happy path, and one validation failure.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const m = vi.hoisted(() => ({
  authenticateAPI: vi.fn(),
  requireScopes: vi.fn(),
  requireTaskAccess: vi.fn(),
  handoffTask: vi.fn(),
  recordTaskCost: vi.fn(),
  taskCostGate: vi.fn(),
  resolveTaskId: vi.fn(),
  loadListAgentRoster: vi.fn(),
  recordGoalMeasurement: vi.fn(),
}))

vi.mock('@/lib/api-auth-middleware', () => {
  class UnauthorizedError extends Error {
    constructor(msg = 'Unauthorized') { super(msg); this.name = 'UnauthorizedError' }
  }
  class ForbiddenError extends Error {
    constructor(msg = 'Forbidden') { super(msg); this.name = 'ForbiddenError' }
  }
  return {
    authenticateAPI: m.authenticateAPI,
    requireScopes: m.requireScopes,
    requireTaskAccess: m.requireTaskAccess,
    getDeprecationWarning: vi.fn(() => null),
    UnauthorizedError,
    ForbiddenError,
  }
})
vi.mock('@/lib/task-identifier', () => ({ resolveTaskIdOrIdentifier: m.resolveTaskId }))
vi.mock('@/services/task-handoff.service', () => ({ handoffTask: m.handoffTask }))
vi.mock('@/lib/task-cost', () => ({ taskCostGate: m.taskCostGate }))
vi.mock('@/lib/task-cost-events', () => ({ recordTaskCost: m.recordTaskCost }))
vi.mock('@/services/agent-presence.service', () => ({ loadListAgentRoster: m.loadListAgentRoster }))
vi.mock('@/services/project-goals.service', () => ({ recordGoalMeasurement: m.recordGoalMeasurement }))
vi.mock('@/lib/api/project-goals-response', () => ({
  goalsResponse: (result: { ok: boolean; status?: number; error?: string }) =>
    result.ok ? NextResponse.json({ goals: [] }) : NextResponse.json({ error: result.error }, { status: result.status }),
}))
vi.mock('@/lib/ai-agent-author', () => ({
  validateMcpAgentSelection: vi.fn(() => null),
  resolveAgentAuthor: vi.fn(async (auth: { userId: string }) => ({ ok: true, authorId: auth.userId })),
}))
vi.mock('@/lib/analytics-events', () => ({ detectPlatform: vi.fn(() => 'web') }))

import { POST as handoff } from '@/app/api/v1/tasks/[id]/handoff/route'
import { POST as cost } from '@/app/api/v1/tasks/[id]/cost/route'
import { GET as agents } from '@/app/api/v1/lists/[id]/agents/route'
import { PUT as measure } from '@/app/api/v1/projects/[id]/goals/[goalId]/measure/route'
import { UnauthorizedError, ForbiddenError } from '@/lib/api-auth-middleware'

const auth = {
  userId: 'user-1',
  source: 'oauth' as const,
  scopes: ['*'],
  isAIAgent: false,
  user: { id: 'user-1', email: 'jon@example.com', name: 'Jon', isAIAgent: false },
}

const json = (url: string, method: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) }) as never

beforeEach(() => {
  vi.clearAllMocks()
  m.authenticateAPI.mockResolvedValue(auth)
  m.requireScopes.mockReturnValue(undefined)
  m.requireTaskAccess.mockResolvedValue(undefined)
  m.resolveTaskId.mockImplementation(async (id: string) => (id === 'missing' ? null : id))
  m.taskCostGate.mockResolvedValue(null)
})

describe('POST /api/v1/tasks/:id/handoff (ADEV-293)', () => {
  const call = (body: unknown, id = 'task-1') => handoff(json(`/api/v1/tasks/${id}/handoff`, 'POST', body), ctx({ id }))

  it('401 when unauthenticated', async () => {
    m.authenticateAPI.mockRejectedValue(new UnauthorizedError())
    expect((await call({})).status).toBe(401)
    expect(m.handoffTask).not.toHaveBeenCalled()
  })

  it('404 for an unknown task and 403 without write access', async () => {
    expect((await call({}, 'missing')).status).toBe(404)
    m.requireTaskAccess.mockRejectedValue(new ForbiddenError())
    expect((await call({ targetListId: 'l2', title: 'x' })).status).toBe(403)
    expect(m.handoffTask).not.toHaveBeenCalled()
  })

  it('201 with the created half on the happy path', async () => {
    m.handoffTask.mockResolvedValue({
      ok: true,
      half: { id: 'half-1', identifier: 'ADEV-9', title: 'Other half', statusRole: 'ready', lists: [{ id: 'l2' }] },
      source: { id: 'task-1' },
      returnAssigneeId: 'user-1',
    })
    const res = await call({ targetListId: 'l2', title: 'Other half' })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.half).toEqual({ id: 'half-1', identifier: 'ADEV-9', title: 'Other half', statusRole: 'ready', listIds: ['l2'] })
    expect(body.returnAssigneeId).toBe('user-1')
    expect(m.handoffTask).toHaveBeenCalledWith(expect.objectContaining({ sourceTaskId: 'task-1', targetListId: 'l2', actorId: 'user-1' }))
  })

  it('400 on a malformed body and passes a service refusal through with its code', async () => {
    expect((await call('{not json')).status).toBe(400)
    m.handoffTask.mockResolvedValue({ ok: false, status: 409, error: 'Task is done', code: 'HANDOFF_SOURCE_DONE' })
    const res = await call({ targetListId: 'l2', title: 'x' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Task is done', code: 'HANDOFF_SOURCE_DONE' })
  })
})

describe('POST /api/v1/tasks/:id/cost (ADEV-293)', () => {
  const call = (body: unknown, id = 'task-1') => cost(json(`/api/v1/tasks/${id}/cost`, 'POST', body), ctx({ id }))
  const payload = { provider: 'anthropic', model: 'm', inputTokens: 1, outputTokens: 2, costMicrocents: 3 }

  it('401 when unauthenticated', async () => {
    m.authenticateAPI.mockRejectedValue(new UnauthorizedError())
    expect((await call(payload)).status).toBe(401)
    expect(m.recordTaskCost).not.toHaveBeenCalled()
  })

  it('answers the gate response before looking at the task, and 403 without access', async () => {
    m.taskCostGate.mockResolvedValue(NextResponse.json({ error: 'Not found' }, { status: 404 }))
    expect((await call(payload)).status).toBe(404)
    expect(m.requireTaskAccess).not.toHaveBeenCalled()
    m.taskCostGate.mockResolvedValue(null)
    m.requireTaskAccess.mockRejectedValue(new ForbiddenError())
    expect((await call(payload)).status).toBe(403)
    expect(m.recordTaskCost).not.toHaveBeenCalled()
  })

  it('201 for a new event, 200 for a duplicate', async () => {
    m.recordTaskCost.mockResolvedValue({ ok: true, event: { id: 'e1' }, duplicate: false })
    const created = await call(payload)
    expect(created.status).toBe(201)
    expect(m.recordTaskCost).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'task-1', provider: 'anthropic' }))
    m.recordTaskCost.mockResolvedValue({ ok: true, event: { id: 'e1' }, duplicate: true })
    expect((await call(payload)).status).toBe(200)
  })

  it('returns the validation status from recordTaskCost', async () => {
    m.recordTaskCost.mockResolvedValue({ ok: false, status: 400, error: 'inputTokens must be a number' })
    const res = await call({ ...payload, inputTokens: 'x' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/inputTokens/)
  })
})

describe('GET /api/v1/lists/:id/agents (ADEV-293)', () => {
  const call = () => agents(json('/api/v1/lists/l1/agents', 'GET'), ctx({ id: 'l1' }))

  it('401 when unauthenticated', async () => {
    m.authenticateAPI.mockRejectedValue(new UnauthorizedError())
    expect((await call()).status).toBe(401)
  })

  it('404 when the caller cannot see the list', async () => {
    m.loadListAgentRoster.mockResolvedValue(null)
    expect((await call()).status).toBe(404)
    expect(m.loadListAgentRoster).toHaveBeenCalledWith('l1', 'user-1')
  })

  it('returns the roster', async () => {
    m.loadListAgentRoster.mockResolvedValue({ agents: [{ mailbox: 'claude' }] })
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ roster: { agents: [{ mailbox: 'claude' }] } })
  })
})

describe('PUT /api/v1/projects/:id/goals/:goalId/measure (ADEV-293)', () => {
  const call = (body: unknown) =>
    measure(json('/api/v1/projects/p1/goals/g1/measure', 'PUT', body), ctx({ id: 'p1', goalId: 'g1' }))

  it('401 when unauthenticated', async () => {
    m.authenticateAPI.mockRejectedValue(new UnauthorizedError())
    expect((await call({ current: 1 })).status).toBe(401)
    expect(m.recordGoalMeasurement).not.toHaveBeenCalled()
  })

  it('passes the service refusal (no project access) through', async () => {
    m.recordGoalMeasurement.mockResolvedValue({ ok: false, status: 404, error: 'Project not found' })
    expect((await call({ current: 1 })).status).toBe(404)
  })

  it('records a measurement signed by the user', async () => {
    m.recordGoalMeasurement.mockResolvedValue({ ok: true })
    const res = await call({ current: 5 })
    expect(res.status).toBe(200)
    expect(m.recordGoalMeasurement).toHaveBeenCalledWith('p1', 'user-1', 'g1', { current: 5 }, 'user-1', 'human')
  })

  it('400 when the body is not JSON', async () => {
    expect((await call('nope')).status).toBe(400)
    expect(m.recordGoalMeasurement).not.toHaveBeenCalled()
  })
})
