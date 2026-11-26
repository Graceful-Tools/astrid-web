/**
 * Route tests (ADEV-293): /api/v1/sync/github/links, /api/v1/sync/google/links,
 * /api/v1/integrations, /api/sse/health, /api/sse/status.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  authenticateAPI: vi.fn(),
  requireScopes: vi.fn(),
  getUnifiedSession: vi.fn(),
  isAdmin: vi.fn(),
  getConnectionsStatus: vi.fn(),
  linkFindMany: vi.fn(),
  linkUpsert: vi.fn(),
  linkDeleteMany: vi.fn(),
  listFindFirst: vi.fn(),
  integrationFindMany: vi.fn(),
  integrationFindUnique: vi.fn(),
  integrationUpdate: vi.fn(),
  integrationUpdateMany: vi.fn(),
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
vi.mock('@/lib/admin-auth', () => ({ isAdmin: m.isAdmin }))
vi.mock('@/lib/sse-utils', () => ({ getConnectionsStatus: m.getConnectionsStatus }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    externalListLink: { findMany: m.linkFindMany, upsert: m.linkUpsert, deleteMany: m.linkDeleteMany },
    taskList: { findFirst: m.listFindFirst },
    integration: {
      findMany: m.integrationFindMany,
      findUnique: m.integrationFindUnique,
      update: m.integrationUpdate,
      updateMany: m.integrationUpdateMany,
    },
  },
}))
vi.mock('@/lib/sync/google', () => ({ googleTokenFor: m.googleTokenFor, googleRequest: m.googleRequest }))

import { GET as githubLinksGet, POST as githubLinksPost, DELETE as githubLinksDelete } from '@/app/api/v1/sync/github/links/route'
import { GET as googleLinksGet, POST as googleLinksPost, DELETE as googleLinksDelete } from '@/app/api/v1/sync/google/links/route'
import { GET as integrationsGet, PATCH as integrationsPatch, DELETE as integrationsDelete } from '@/app/api/v1/integrations/route'
import { GET as sseHealth } from '@/app/api/sse/health/route'
import { GET as sseStatus } from '@/app/api/sse/status/route'
import { UnauthorizedError } from '@/lib/api-auth-middleware'

const auth = { userId: 'user-1', source: 'oauth' as const, scopes: ['*'], isAIAgent: false, user: { id: 'user-1' } }
const req = (url: string, method = 'GET', body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
const noCtx = undefined as never

beforeEach(() => {
  vi.clearAllMocks()
  m.authenticateAPI.mockResolvedValue(auth)
  m.requireScopes.mockReturnValue(undefined)
})

describe.each([
  { name: 'github', get: githubLinksGet, post: githubLinksPost, del: githubLinksDelete, provider: 'GITHUB_ISSUES', remote: 'o/r' },
  { name: 'google', get: googleLinksGet, post: googleLinksPost, del: googleLinksDelete, provider: 'GOOGLE_TASKS', remote: 'tl-1' },
])('/api/v1/sync/$name/links (ADEV-293)', ({ name, get, post, del, provider, remote }) => {
  const url = `/api/v1/sync/${name}/links`

  it('401 when unauthenticated, on every method', async () => {
    m.authenticateAPI.mockRejectedValue(new UnauthorizedError())
    expect((await get(req(url), noCtx)).status).toBe(401)
    expect((await post(req(url, 'POST', {}), noCtx)).status).toBe(401)
    expect((await del(req(`${url}?linkId=x`, 'DELETE'), noCtx)).status).toBe(401)
    expect(m.linkUpsert).not.toHaveBeenCalled()
    expect(m.linkDeleteMany).not.toHaveBeenCalled()
  })

  it("GET reads only the caller's links for this provider, optionally for one list", async () => {
    m.linkFindMany.mockResolvedValue([])
    await get(req(`${url}?listId=l1`), noCtx)
    expect(m.linkFindMany).toHaveBeenCalledWith({ where: { userId: 'user-1', provider, astridListId: 'l1' } })
  })

  it('POST 400 without both ids', async () => {
    expect((await post(req(url, 'POST', { astridListId: 'l1' }), noCtx)).status).toBe(400)
    expect(m.linkUpsert).not.toHaveBeenCalled()
  })

  it('POST 404 for a list the caller neither owns nor belongs to', async () => {
    m.listFindFirst.mockResolvedValue(null)
    expect((await post(req(url, 'POST', { astridListId: 'l1', remoteContainerId: remote }), noCtx)).status).toBe(404)
    expect(m.linkUpsert).not.toHaveBeenCalled()
  })

  it('POST 401 when the provider is not connected or was revoked', async () => {
    m.listFindFirst.mockResolvedValue({ id: 'l1' })
    m.integrationFindUnique.mockResolvedValue(null)
    expect((await post(req(url, 'POST', { astridListId: 'l1', remoteContainerId: remote }), noCtx)).status).toBe(401)
    m.integrationFindUnique.mockResolvedValue({ id: 'int-1', revokedAt: new Date() })
    expect((await post(req(url, 'POST', { astridListId: 'l1', remoteContainerId: remote }), noCtx)).status).toBe(401)
    expect(m.linkUpsert).not.toHaveBeenCalled()
  })

  it('POST links the list and resets the sync cursor on a re-link', async () => {
    m.listFindFirst.mockResolvedValue({ id: 'l1' })
    m.integrationFindUnique.mockResolvedValue({ id: 'int-1', revokedAt: null })
    m.googleTokenFor.mockResolvedValue(null)
    m.linkUpsert.mockResolvedValue({ id: 'link-1' })
    const res = await post(req(url, 'POST', { astridListId: 'l1', remoteContainerId: remote }), noCtx)
    expect(res.status).toBe(200)
    const args = m.linkUpsert.mock.calls[0][0]
    expect(args.create).toMatchObject({ userId: 'user-1', astridListId: 'l1', provider, remoteContainerId: remote })
    expect(args.update).toMatchObject({ remoteContainerId: remote, cursor: null })
  })

  it('DELETE needs linkId and only removes the caller\'s own link', async () => {
    expect((await del(req(url, 'DELETE'), noCtx)).status).toBe(400)
    expect((await del(req(`${url}?linkId=link-9`, 'DELETE'), noCtx)).status).toBe(200)
    expect(m.linkDeleteMany).toHaveBeenCalledWith({ where: { id: 'link-9', userId: 'user-1' } })
  })
})

describe('github links: repo id validation (ADEV-293)', () => {
  it('400 when remoteContainerId is not owner/repo', async () => {
    const res = await githubLinksPost(
      req('/api/v1/sync/github/links', 'POST', { astridListId: 'l1', remoteContainerId: 'not a repo' }),
      noCtx,
    )
    expect(res.status).toBe(400)
    expect(m.listFindFirst).not.toHaveBeenCalled()
  })
})

describe('/api/v1/integrations (ADEV-293)', () => {
  it('401 when unauthenticated', async () => {
    m.authenticateAPI.mockRejectedValue(new UnauthorizedError())
    expect((await integrationsGet(req('/api/v1/integrations'), noCtx)).status).toBe(401)
    expect((await integrationsPatch(req('/api/v1/integrations', 'PATCH', {}), noCtx)).status).toBe(401)
    expect((await integrationsDelete(req('/api/v1/integrations?provider=GOOGLE_TASKS', 'DELETE'), noCtx)).status).toBe(401)
  })

  it('GET lists only live, non-credential providers of the caller', async () => {
    m.integrationFindMany.mockResolvedValue([{ provider: 'GOOGLE_TASKS' }])
    const res = await integrationsGet(req('/api/v1/integrations'), noCtx)
    expect(await res.json()).toEqual({ integrations: [{ provider: 'GOOGLE_TASKS' }] })
    expect(m.integrationFindMany.mock.calls[0][0].where).toEqual({
      userId: 'user-1',
      revokedAt: null,
      provider: { not: 'GITHUB' },
    })
  })

  it('PATCH 400 for an unknown provider or non-object metadata', async () => {
    expect((await integrationsPatch(req('/api/v1/integrations', 'PATCH', { provider: 'GITHUB', metadata: {} }), noCtx)).status).toBe(400)
    expect((await integrationsPatch(req('/api/v1/integrations', 'PATCH', { provider: 'GOOGLE_TASKS', metadata: 'x' }), noCtx)).status).toBe(400)
    expect(m.integrationFindUnique).not.toHaveBeenCalled()
  })

  it('PATCH 404 when not connected, otherwise merges metadata over the stored value', async () => {
    m.integrationFindUnique.mockResolvedValue(null)
    expect((await integrationsPatch(req('/api/v1/integrations', 'PATCH', { provider: 'GOOGLE_TASKS', metadata: { a: 1 } }), noCtx)).status).toBe(404)
    m.integrationFindUnique.mockResolvedValue({ id: 'int-1', revokedAt: null, metadata: { a: 0, keep: true } })
    const res = await integrationsPatch(req('/api/v1/integrations', 'PATCH', { provider: 'GOOGLE_TASKS', metadata: { a: 1 } }), noCtx)
    expect((await res.json()).metadata).toEqual({ a: 1, keep: true })
    expect(m.integrationUpdate).toHaveBeenCalledWith({ where: { id: 'int-1' }, data: { metadata: { a: 1, keep: true } } })
  })

  it('DELETE revokes the caller\'s integration and clears its tokens; an unknown provider is 400', async () => {
    expect((await integrationsDelete(req('/api/v1/integrations?provider=NOPE', 'DELETE'), noCtx)).status).toBe(400)
    expect(m.integrationUpdateMany).not.toHaveBeenCalled()
    const res = await integrationsDelete(req('/api/v1/integrations?provider=GOOGLE_TASKS', 'DELETE'), noCtx)
    expect(res.status).toBe(200)
    const args = m.integrationUpdateMany.mock.calls[0][0]
    expect(args.where).toEqual({ userId: 'user-1', provider: 'GOOGLE_TASKS' })
    expect(args.data).toMatchObject({ accessToken: null, refreshToken: null })
  })
})

describe('GET /api/sse/health and /api/sse/status (ADEV-293)', () => {
  const status = {
    total: 2,
    activeUserIds: ['user-1', 'user-2'],
    connections: [{ userId: 'user-1' }, { userId: 'user-2' }],
  }
  beforeEach(() => {
    m.getUnifiedSession.mockResolvedValue({ user: { id: 'user-1' } })
    m.getConnectionsStatus.mockReturnValue(status)
    m.isAdmin.mockResolvedValue(false)
  })

  it('401 without a session', async () => {
    m.getUnifiedSession.mockResolvedValue(null)
    expect((await sseHealth(req('/api/sse/health'))).status).toBe(401)
    expect((await sseStatus(req('/api/sse/status'))).status).toBe(401)
  })

  it("does not reveal other users' connections to a non-admin", async () => {
    const health = await (await sseHealth(req('/api/sse/health'))).json()
    expect(health).toMatchObject({ userConnected: true, totalConnections: 2 })
    expect(health.activeUserIds).toBeUndefined()
    expect(health.allConnections).toBeUndefined()
    const st = await (await sseStatus(req('/api/sse/status'))).json()
    expect(st.activeConnections).toBeUndefined()
    expect(st.totalConnections).toBe(2)
  })

  it('shows the full list to an admin', async () => {
    m.isAdmin.mockResolvedValue(true)
    const health = await (await sseHealth(req('/api/sse/health'))).json()
    expect(health.activeUserIds).toEqual(['user-1', 'user-2'])
    const st = await (await sseStatus(req('/api/sse/status'))).json()
    expect(st.activeConnections).toEqual(['user-1', 'user-2'])
  })
})
