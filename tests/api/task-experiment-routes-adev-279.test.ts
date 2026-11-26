/**
 * Route tests for the experiment links and the results-settle cron (ADEV-279):
 * /api/v1/tasks/:id/experiment (GET, POST, DELETE), .../experiment/refresh and
 * /api/cron/results-settle.
 *
 * The service owns the rules (tests/services/task-experiment-adev-279.test.ts); these pin the
 * route's own job: gate, identifier resolution, access check, body shape, status mapping.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  getTaskExperiments: vi.fn(),
  linkTaskExperiment: vi.fn(),
  unlinkTaskExperiment: vi.fn(),
  refreshTaskExperiments: vi.fn(),
  runResultsSettlePass: vi.fn(),
  goalSignalsGate: vi.fn(),
  capabilityGate: vi.fn(),
  authenticateAPI: vi.fn(),
  requireScopes: vi.fn(),
  requireTaskAccess: vi.fn(),
  requireTaskReadAccess: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/cron-observability', () => ({
  runCronJob: async (_name: string, fn: () => Promise<unknown>) => Response.json({ success: true, ...(await fn() as object) }),
}))
vi.mock('@/lib/brand/capabilities', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/brand/capabilities')>()),
  capabilityGate: m.capabilityGate,
}))
vi.mock('@/lib/goal-signals', () => ({ goalSignalsGate: m.goalSignalsGate }))
vi.mock('@/services/task-experiment.service', () => ({
  getTaskExperiments: m.getTaskExperiments,
  linkTaskExperiment: m.linkTaskExperiment,
  unlinkTaskExperiment: m.unlinkTaskExperiment,
  refreshTaskExperiments: m.refreshTaskExperiments,
  runResultsSettlePass: m.runResultsSettlePass,
}))
vi.mock('@/lib/task-identifier', () => ({
  resolveTaskIdOrIdentifier: vi.fn(async (value: string) => (value === 'ADEV-404' ? null : value === 'ADEV-7' ? 'task-uuid-7' : value)),
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
    requireTaskReadAccess: m.requireTaskReadAccess,
    getDeprecationWarning: vi.fn(() => null),
    UnauthorizedError,
    ForbiddenError,
  }
})

import { GET, POST, DELETE } from '@/app/api/v1/tasks/[id]/experiment/route'
import { POST as refresh } from '@/app/api/v1/tasks/[id]/experiment/refresh/route'
import { GET as resultsSettle } from '@/app/api/cron/results-settle/route'

const auth = {
  userId: 'user-1',
  source: 'oauth' as const,
  scopes: ['tasks:read', 'tasks:write'],
  isAIAgent: false,
  user: { id: 'user-1', email: 'jon@example.com', name: 'Jon', isAIAgent: false },
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never
const url = (id: string, suffix = '') => `http://localhost/api/v1/tasks/${id}/experiment${suffix}`
const call = (method: string, id: string, body?: string, suffix = '') =>
  new NextRequest(url(id, suffix), { method, body, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  vi.clearAllMocks()
  m.authenticateAPI.mockResolvedValue(auth)
  m.requireScopes.mockReturnValue(undefined)
  m.requireTaskAccess.mockResolvedValue(undefined)
  m.requireTaskReadAccess.mockResolvedValue(undefined)
  m.goalSignalsGate.mockResolvedValue(null)
  m.capabilityGate.mockReturnValue(null)
})

describe('/api/v1/tasks/:id/experiment (ADEV-279)', () => {
  it('GET resolves the identifier, checks read access on the uuid and returns the links', async () => {
    m.getTaskExperiments.mockResolvedValue({ ok: true, value: { experiments: [], verifications: [] } })
    const res = await GET(call('GET', 'ADEV-7'), ctx('ADEV-7'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ experiments: [], verifications: [], meta: { apiVersion: 'v1' } })
    expect(m.requireTaskReadAccess).toHaveBeenCalledWith('user-1', 'task-uuid-7')
    expect(m.getTaskExperiments).toHaveBeenCalledWith('task-uuid-7')
  })

  it('answers the gate before touching the task', async () => {
    m.goalSignalsGate.mockResolvedValue(Response.json({ error: 'off' }, { status: 404 }))
    const res = await GET(call('GET', 'ADEV-7'), ctx('ADEV-7'))
    expect(res.status).toBe(404)
    expect(m.getTaskExperiments).not.toHaveBeenCalled()
    expect(m.requireTaskReadAccess).not.toHaveBeenCalled()
  })

  it('an identifier that matches nothing is 404 with no access check', async () => {
    const res = await GET(call('GET', 'ADEV-404'), ctx('ADEV-404'))
    expect(res.status).toBe(404)
    expect(m.requireTaskReadAccess).not.toHaveBeenCalled()
  })

  it('a service refusal keeps its status and reason', async () => {
    m.getTaskExperiments.mockResolvedValue({ ok: false, status: 409, error: 'nope', reason: 'why' })
    const res = await GET(call('GET', 'ADEV-7'), ctx('ADEV-7'))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'nope', reason: 'why' })
  })

  it('POST links an experiment and answers 201', async () => {
    const body = { kind: 'experiment', connectorId: 'c1', externalKey: 'exp-1' }
    m.linkTaskExperiment.mockResolvedValue({ ok: true, value: { id: 'link-1' } })
    const res = await POST(call('POST', 'ADEV-7', JSON.stringify(body)), ctx('ADEV-7'))
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ experiment: { id: 'link-1' } })
    expect(m.requireTaskAccess).toHaveBeenCalledWith('user-1', 'task-uuid-7')
    expect(m.linkTaskExperiment).toHaveBeenCalledWith('task-uuid-7', body)
  })

  it('POST rejects a body that is not a JSON object', async () => {
    for (const bad of ['not json', '[]', 'null']) {
      const res = await POST(call('POST', 'ADEV-7', bad), ctx('ADEV-7'))
      expect(res.status).toBe(400)
    }
    expect(m.linkTaskExperiment).not.toHaveBeenCalled()
  })

  it('DELETE needs experimentId, then unlinks that one', async () => {
    const missing = await DELETE(call('DELETE', 'ADEV-7'), ctx('ADEV-7'))
    expect(missing.status).toBe(400)
    m.unlinkTaskExperiment.mockResolvedValue({ ok: true, value: { removed: true } })
    const res = await DELETE(call('DELETE', 'ADEV-7', undefined, '?experimentId=link-1'), ctx('ADEV-7'))
    expect(res.status).toBe(200)
    expect(m.unlinkTaskExperiment).toHaveBeenCalledWith('task-uuid-7', 'link-1')
  })
})

describe('POST /api/v1/tasks/:id/experiment/refresh (ADEV-279)', () => {
  it('refreshes and reports what the lane did', async () => {
    m.refreshTaskExperiments.mockResolvedValue({ ok: true, value: { lane: 'not-in-column' } })
    const res = await refresh(call('POST', 'ADEV-7', undefined, '/refresh'), ctx('ADEV-7'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ lane: 'not-in-column' })
    expect(m.requireTaskAccess).toHaveBeenCalledWith('user-1', 'task-uuid-7')
    expect(m.refreshTaskExperiments).toHaveBeenCalledWith('task-uuid-7')
  })

  it('is gated, and 404s an unknown identifier', async () => {
    const missing = await refresh(call('POST', 'ADEV-404', undefined, '/refresh'), ctx('ADEV-404'))
    expect(missing.status).toBe(404)
    m.goalSignalsGate.mockResolvedValue(Response.json({ error: 'off' }, { status: 404 }))
    await refresh(call('POST', 'ADEV-7', undefined, '/refresh'), ctx('ADEV-7'))
    expect(m.refreshTaskExperiments).not.toHaveBeenCalled()
  })

  it('maps a service refusal to its status', async () => {
    m.refreshTaskExperiments.mockResolvedValue({ ok: false, status: 404, error: 'Task not found' })
    const res = await refresh(call('POST', 'ADEV-7', undefined, '/refresh'), ctx('ADEV-7'))
    expect(res.status).toBe(404)
  })
})

describe('GET /api/cron/results-settle (ADEV-279)', () => {
  const SECRET = 'test-cron-secret'
  const originalSecret = process.env.CRON_SECRET
  const cronReq = (authorized: boolean) =>
    new NextRequest('http://localhost/api/cron/results-settle', {
      headers: authorized ? { authorization: `Bearer ${SECRET}` } : {},
    })

  beforeEach(() => {
    process.env.CRON_SECRET = SECRET
    m.runResultsSettlePass.mockResolvedValue({ scanned: 3, refreshed: 2 })
  })
  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = originalSecret
  })

  it('401 without the secret, and runs nothing', async () => {
    expect((await resultsSettle(cronReq(false))).status).toBe(401)
    expect(m.runResultsSettlePass).not.toHaveBeenCalled()
  })

  it('runs one pass with the secret', async () => {
    const res = await resultsSettle(cronReq(true))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ scanned: 3, refreshed: 2 })
    expect(m.runResultsSettlePass).toHaveBeenCalledTimes(1)
  })

  it('a deployment without Goal Signals runs nothing', async () => {
    m.capabilityGate.mockReturnValue(Response.json({ error: 'off' }, { status: 404 }))
    expect((await resultsSettle(cronReq(true))).status).toBe(404)
    expect(m.runResultsSettlePass).not.toHaveBeenCalled()
  })
})
