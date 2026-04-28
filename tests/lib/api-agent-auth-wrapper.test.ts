import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/api-auth-middleware', () => {
  class UnauthorizedError extends Error {
    constructor(msg = 'Unauthorized') { super(msg); this.name = 'UnauthorizedError' }
  }
  class ForbiddenError extends Error {
    constructor(msg = 'Forbidden') { super(msg); this.name = 'ForbiddenError' }
  }
  return { UnauthorizedError, ForbiddenError }
})

vi.mock('@/lib/agent-protocol', () => ({
  authenticateAgentRequest: vi.fn(),
}))

import { withAgentAuth } from '@/lib/api-agent-auth-wrapper'
import { authenticateAgentRequest } from '@/lib/agent-protocol'
import { UnauthorizedError, ForbiddenError } from '@/lib/api-auth-middleware'

const mockAuth = vi.mocked(authenticateAgentRequest)

const goodAuth = {
  userId: 'agent-1',
  source: 'oauth' as const,
  scopes: ['tasks:read'],
  isAIAgent: true,
  user: { id: 'agent-1', email: 'a.oc@astrid.cc', name: 'Agent', isAIAgent: true },
}

function makeReq(): NextRequest {
  return new NextRequest('http://localhost/api/v1/agent/tasks')
}

describe('withAgentAuth', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes auth context to the handler on success', async () => {
    mockAuth.mockResolvedValue(goodAuth as any)
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }))

    const route = withAgentAuth({ requiredScopes: ['tasks:read'] }, handler)
    const res = await route(makeReq(), undefined as any)

    expect(res.status).toBe(200)
    expect(handler).toHaveBeenCalledWith(expect.anything(), goodAuth, undefined)
  })

  it('forwards the requested scopes to authenticateAgentRequest', async () => {
    mockAuth.mockResolvedValue(goodAuth as any)
    const route = withAgentAuth(
      { requiredScopes: ['tasks:read', 'comments:write'] },
      async () => NextResponse.json({}),
    )

    await route(makeReq(), undefined as any)

    expect(mockAuth).toHaveBeenCalledWith(expect.anything(), ['tasks:read', 'comments:write'])
  })

  it("defaults to ['tasks:read'] when requiredScopes omitted", async () => {
    mockAuth.mockResolvedValue(goodAuth as any)
    const route = withAgentAuth({}, async () => NextResponse.json({}))

    await route(makeReq(), undefined as any)

    expect(mockAuth).toHaveBeenCalledWith(expect.anything(), ['tasks:read'])
  })

  it('returns 401 when authenticateAgentRequest throws UnauthorizedError', async () => {
    mockAuth.mockRejectedValue(new UnauthorizedError('Bad token'))
    const route = withAgentAuth({}, async () => NextResponse.json({}))

    const res = await route(makeReq(), undefined as any)
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json).toMatchObject({ error: 'Unauthorized', message: 'Bad token' })
  })

  it('returns 403 when authenticateAgentRequest throws ForbiddenError', async () => {
    mockAuth.mockRejectedValue(new ForbiddenError('Missing scope'))
    const route = withAgentAuth({}, async () => NextResponse.json({}))

    const res = await route(makeReq(), undefined as any)
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json).toMatchObject({ error: 'Forbidden', message: 'Missing scope' })
  })

  it('returns 500 when auth throws an unexpected error', async () => {
    mockAuth.mockRejectedValue(new Error('database down'))
    const route = withAgentAuth({}, async () => NextResponse.json({}))

    const res = await route(makeReq(), undefined as any)
    expect(res.status).toBe(500)
  })

  it('catches handler-thrown UnauthorizedError → 401', async () => {
    mockAuth.mockResolvedValue(goodAuth as any)
    const route = withAgentAuth({}, async () => {
      throw new UnauthorizedError('Something rejected mid-flight')
    })

    const res = await route(makeReq(), undefined as any)
    expect(res.status).toBe(401)
  })

  it('catches handler-thrown ForbiddenError → 403', async () => {
    mockAuth.mockResolvedValue(goodAuth as any)
    const route = withAgentAuth({}, async () => {
      throw new ForbiddenError('Not your task')
    })

    const res = await route(makeReq(), undefined as any)
    expect(res.status).toBe(403)
  })

  it('catches generic handler errors → 500 (does not leak stack)', async () => {
    mockAuth.mockResolvedValue(goodAuth as any)
    const route = withAgentAuth({}, async () => {
      throw new Error('something broke')
    })

    const res = await route(makeReq(), undefined as any)
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json).toEqual({ error: 'Internal server error' })
  })

  it('passes the route context (params) to the handler', async () => {
    mockAuth.mockResolvedValue(goodAuth as any)
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }))
    const route = withAgentAuth<{ params: Promise<{ id: string }> }>({}, handler)

    const ctx = { params: Promise.resolve({ id: 'task-1' }) }
    await route(makeReq(), ctx as any)

    expect(handler).toHaveBeenCalledWith(expect.anything(), goodAuth, ctx)
  })
})
