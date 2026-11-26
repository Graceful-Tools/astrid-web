/**
 * Route tests for more routes no test referenced (ADEV-293):
 * GET /api/lists/:id/invites, POST /api/v1/chat/channels/:id/astrid-response,
 * GET+POST /api/v1/projects/:id/connectors, POST .../connectors/:cid/test,
 * GET /api/v1/sync/github/repos, GET+POST /api/v1/sync/google/tasklists.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const m = vi.hoisted(() => ({
  authenticateAPI: vi.fn(),
  requireScopes: vi.fn(),
  getUnifiedSession: vi.fn(),
  listFindUnique: vi.fn(),
  invitationFindMany: vi.fn(),
  canUserManageMembers: vi.fn(),
  handOffAstridReply: vi.fn(),
  connectorRouteGuard: vi.fn(),
  listConnectors: vi.fn(),
  createConnector: vi.fn(),
  testConnector: vi.fn(),
  githubTokenFor: vi.fn(),
  githubRequest: vi.fn(),
  googleTokenFor: vi.fn(),
  googleRequest: vi.fn(),
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
    getDeprecationWarning: vi.fn(() => null),
    UnauthorizedError,
    ForbiddenError,
  }
})
vi.mock('@/lib/session-utils', () => ({ getUnifiedSession: m.getUnifiedSession }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: { findUnique: m.listFindUnique },
    invitation: { findMany: m.invitationFindMany },
  },
}))
vi.mock('@/lib/list-permissions', () => ({
  canUserManageMembers: m.canUserManageMembers,
  getUserRoleInList: vi.fn(),
  prismaToTaskList: (list: unknown) => list,
}))
vi.mock('@/lib/astrid-handoff', () => ({ handOffAstridReply: m.handOffAstridReply }))
vi.mock('@/lib/api/project-connectors-response', () => ({
  connectorRouteGuard: m.connectorRouteGuard,
  connectorsResponse: (result: { ok: boolean; status?: number; error?: string }, _auth: unknown, status = 200) =>
    result.ok ? NextResponse.json({ ok: true }, { status }) : NextResponse.json({ error: result.error }, { status: result.status }),
}))
vi.mock('@/services/project-connectors.service', () => ({
  listConnectors: m.listConnectors,
  createConnector: m.createConnector,
  testConnector: m.testConnector,
}))
vi.mock('@/lib/sync/github', () => ({ githubTokenFor: m.githubTokenFor, githubRequest: m.githubRequest }))
vi.mock('@/lib/sync/google', () => ({ googleTokenFor: m.googleTokenFor, googleRequest: m.googleRequest }))

import { GET as invites } from '@/app/api/lists/[id]/invites/route'
import { POST as astridResponse } from '@/app/api/v1/chat/channels/[channelId]/astrid-response/route'
import { GET as listConnectorsRoute, POST as createConnectorRoute } from '@/app/api/v1/projects/[id]/connectors/route'
import { POST as testConnectorRoute } from '@/app/api/v1/projects/[id]/connectors/[connectorId]/test/route'
import { GET as githubRepos } from '@/app/api/v1/sync/github/repos/route'
import { GET as googleTasklists, POST as createGoogleTasklist } from '@/app/api/v1/sync/google/tasklists/route'
import { UnauthorizedError } from '@/lib/api-auth-middleware'

const auth = {
  userId: 'user-1',
  source: 'oauth' as const,
  scopes: ['*'],
  isAIAgent: false,
  user: { id: 'user-1', email: 'jon@example.com', name: 'Jon', isAIAgent: false },
}
const req = (url: string, method = 'GET', body?: unknown) =>
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
  m.connectorRouteGuard.mockResolvedValue(null)
})

describe('GET /api/lists/:id/invites (ADEV-293)', () => {
  const call = () => invites(req('/api/lists/l1/invites'), ctx({ id: 'l1' }))
  beforeEach(() => {
    m.getUnifiedSession.mockResolvedValue({ user: { id: 'user-1', email: 'jon@example.com', name: 'Jon' } })
    m.listFindUnique.mockResolvedValue({ id: 'l1' })
    m.canUserManageMembers.mockReturnValue(true)
    m.invitationFindMany.mockResolvedValue([{ id: 'inv-1', email: 'a@example.com', role: 'member' }])
  })

  it('401 without a session', async () => {
    m.getUnifiedSession.mockResolvedValue(null)
    expect((await call()).status).toBe(401)
    expect(m.invitationFindMany).not.toHaveBeenCalled()
  })

  it('404 for an unknown list', async () => {
    m.listFindUnique.mockResolvedValue(null)
    expect((await call()).status).toBe(404)
  })

  it('403 for someone who cannot manage members, and no invitations are read', async () => {
    m.canUserManageMembers.mockReturnValue(false)
    expect((await call()).status).toBe(403)
    expect(m.invitationFindMany).not.toHaveBeenCalled()
  })

  it('lists only pending, unexpired list-sharing invitations', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect((await res.json()).invites).toHaveLength(1)
    const where = m.invitationFindMany.mock.calls[0][0].where
    expect(where).toMatchObject({ listId: 'l1', status: 'PENDING', type: 'LIST_SHARING' })
    expect(where.expiresAt.gt).toBeInstanceOf(Date)
  })
})

describe('POST /api/v1/chat/channels/:id/astrid-response (ADEV-293)', () => {
  const call = (body: unknown) =>
    astridResponse(req('/api/v1/chat/channels/c1/astrid-response', 'POST', body), ctx({ channelId: 'c1' }))

  it('401 when unauthenticated', async () => {
    m.authenticateAPI.mockRejectedValue(new UnauthorizedError())
    expect((await call({})).status).toBe(401)
    expect(m.handOffAstridReply).not.toHaveBeenCalled()
  })

  it('passes a refusal (no channel access) through', async () => {
    m.handOffAstridReply.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })
    expect((await call({ message_id: 'm1', content: 'hi' })).status).toBe(403)
  })

  it('202 accepted: the reply arrives later over SSE', async () => {
    m.handOffAstridReply.mockResolvedValue({ ok: true, dispatched: true })
    const res = await call({ message_id: 'm1', content: 'hi' })
    expect(res.status).toBe(202)
    expect(await res.json()).toMatchObject({ accepted: true, dispatched: true })
    expect(m.handOffAstridReply).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'c1', userId: 'user-1', messageId: 'm1', content: 'hi' }),
    )
  })

  it('400 on a body that is not JSON', async () => {
    expect((await call('nope')).status).toBe(400)
    expect(m.handOffAstridReply).not.toHaveBeenCalled()
  })
})

describe('project connector routes (ADEV-293)', () => {
  it('401 when unauthenticated, on all three', async () => {
    m.authenticateAPI.mockRejectedValue(new UnauthorizedError())
    expect((await listConnectorsRoute(req('/api/v1/projects/p1/connectors'), ctx({ id: 'p1' }))).status).toBe(401)
    expect((await createConnectorRoute(req('/api/v1/projects/p1/connectors', 'POST', {}), ctx({ id: 'p1' }))).status).toBe(401)
    expect((await testConnectorRoute(req('/x', 'POST', {}), ctx({ id: 'p1', connectorId: 'c1' }))).status).toBe(401)
  })

  it('answers the guard response (gate off, or an agent caller) without touching the service', async () => {
    m.connectorRouteGuard.mockResolvedValue(NextResponse.json({ error: 'Not found' }, { status: 404 }))
    expect((await listConnectorsRoute(req('/api/v1/projects/p1/connectors'), ctx({ id: 'p1' }))).status).toBe(404)
    expect((await createConnectorRoute(req('/api/v1/projects/p1/connectors', 'POST', {}), ctx({ id: 'p1' }))).status).toBe(404)
    expect((await testConnectorRoute(req('/x', 'POST', {}), ctx({ id: 'p1', connectorId: 'c1' }))).status).toBe(404)
    expect(m.listConnectors).not.toHaveBeenCalled()
    expect(m.createConnector).not.toHaveBeenCalled()
    expect(m.testConnector).not.toHaveBeenCalled()
  })

  it('lists, creates (201) and tests a connector for the caller', async () => {
    m.listConnectors.mockResolvedValue({ ok: true })
    m.createConnector.mockResolvedValue({ ok: true })
    m.testConnector.mockResolvedValue({ ok: true })
    expect((await listConnectorsRoute(req('/api/v1/projects/p1/connectors'), ctx({ id: 'p1' }))).status).toBe(200)
    expect(m.listConnectors).toHaveBeenCalledWith('p1', 'user-1')
    const created = await createConnectorRoute(req('/api/v1/projects/p1/connectors', 'POST', { kind: 'metric' }), ctx({ id: 'p1' }))
    expect(created.status).toBe(201)
    expect(m.createConnector).toHaveBeenCalledWith('p1', 'user-1', { kind: 'metric' })
    expect((await testConnectorRoute(req('/x', 'POST', { metricKey: 'k' }), ctx({ id: 'p1', connectorId: 'c1' }))).status).toBe(200)
    expect(m.testConnector).toHaveBeenCalledWith('p1', 'c1', 'user-1', { metricKey: 'k' })
  })

  it('a malformed body reaches the service as null, which refuses it', async () => {
    m.createConnector.mockResolvedValue({ ok: false, status: 400, error: 'Invalid connector' })
    const res = await createConnectorRoute(req('/api/v1/projects/p1/connectors', 'POST', 'nope'), ctx({ id: 'p1' }))
    expect(res.status).toBe(400)
    expect(m.createConnector).toHaveBeenCalledWith('p1', 'user-1', null)
  })
})

describe('GET /api/v1/sync/github/repos (ADEV-293)', () => {
  const call = () => githubRepos(req('/api/v1/sync/github/repos'), undefined as never)

  it('401 when unauthenticated, and 401 when GitHub is not connected', async () => {
    m.authenticateAPI.mockRejectedValue(new UnauthorizedError())
    expect((await call()).status).toBe(401)
    m.authenticateAPI.mockResolvedValue(auth)
    m.githubTokenFor.mockResolvedValue(null)
    const res = await call()
    expect(res.status).toBe(401)
    expect(m.githubRequest).not.toHaveBeenCalled()
  })

  it('maps repos to { id, name, private }', async () => {
    m.githubTokenFor.mockResolvedValue('tok')
    m.githubRequest.mockResolvedValue({ status: 200, json: [{ full_name: 'o/r', private: true, extra: 1 }] })
    const res = await call()
    expect(await res.json()).toEqual({ repos: [{ id: 'o/r', name: 'o/r', private: true }] })
  })

  it('a GitHub 5xx is a 502, a 4xx keeps its status', async () => {
    m.githubTokenFor.mockResolvedValue('tok')
    m.githubRequest.mockResolvedValue({ status: 500, json: {} })
    expect((await call()).status).toBe(502)
    m.githubRequest.mockResolvedValue({ status: 403, json: {} })
    expect((await call()).status).toBe(403)
  })
})

describe('/api/v1/sync/google/tasklists (ADEV-293)', () => {
  const get = () => googleTasklists(req('/api/v1/sync/google/tasklists'), undefined as never)
  const post = (body: unknown) => createGoogleTasklist(req('/api/v1/sync/google/tasklists', 'POST', body), undefined as never)

  it('401 when unauthenticated, and when Google is not connected', async () => {
    m.authenticateAPI.mockRejectedValue(new UnauthorizedError())
    expect((await get()).status).toBe(401)
    expect((await post({ title: 'x' })).status).toBe(401)
    m.authenticateAPI.mockResolvedValue(auth)
    m.googleTokenFor.mockResolvedValue(null)
    expect((await get()).status).toBe(401)
    expect(m.googleRequest).not.toHaveBeenCalled()
  })

  it('GET returns the lists and the real id of the default list', async () => {
    m.googleTokenFor.mockResolvedValue('tok')
    m.googleRequest.mockImplementation(async (_t: string, _m: string, path: string) =>
      path.endsWith('@default')
        ? { status: 200, json: { id: 'def-1' } }
        : { status: 200, json: { items: [{ id: 'def-1', title: 'My Tasks' }] } },
    )
    expect(await (await get()).json()).toEqual({ tasklists: [{ id: 'def-1', name: 'My Tasks' }], defaultId: 'def-1' })
  })

  it('POST requires a title, then creates the list', async () => {
    m.googleTokenFor.mockResolvedValue('tok')
    expect((await post({ title: '   ' })).status).toBe(400)
    expect(m.googleRequest).not.toHaveBeenCalled()
    m.googleRequest.mockResolvedValue({ status: 200, json: { id: 'n1', title: 'New' } })
    const res = await post({ title: ' New ' })
    expect(await res.json()).toEqual({ tasklist: { id: 'n1', name: 'New' } })
    expect(m.googleRequest).toHaveBeenCalledWith('tok', 'POST', '/users/@me/lists', { title: 'New' })
  })
})
