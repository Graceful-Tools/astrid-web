/**
 * Route tests (ADEV-293): /api/admin/feature-requests (GET, PUT),
 * /api/admin/analytics/admins (GET, POST), /api/v1/sync/google/task-links.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  authenticateAPI: vi.fn(),
  requireScopes: vi.fn(),
  requireTaskAccess: vi.fn(),
  getUnifiedSession: vi.fn(),
  requireAdmin: vi.fn(),
  isAdmin: vi.fn(),
  listAdmins: vi.fn(),
  addAdminByEmail: vi.fn(),
  broadcastToAll: vi.fn(),
  invalidateFeatureFlagCache: vi.fn(),
  requestFindMany: vi.fn(),
  requestFindUnique: vi.fn(),
  tx: {
    featureAccessRequest: { update: vi.fn() },
    featureFlag: { findUnique: vi.fn() },
    featureFlagTarget: { upsert: vi.fn(), deleteMany: vi.fn() },
  },
  taskLinkFindMany: vi.fn(),
  taskLinkFindUnique: vi.fn(),
  taskLinkFindFirst: vi.fn(),
  taskLinkUpsert: vi.fn(),
  integrationFindUnique: vi.fn(),
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
vi.mock('@/lib/session-utils', () => ({ getUnifiedSession: m.getUnifiedSession }))
vi.mock('@/lib/admin-auth', () => {
  class AdminAuthError extends Error {}
  return {
    AdminAuthError,
    requireAdmin: m.requireAdmin,
    isAdmin: m.isAdmin,
    listAdmins: m.listAdmins,
    addAdminByEmail: m.addAdminByEmail,
  }
})
vi.mock('@/lib/sse-utils', () => ({ broadcastToAll: m.broadcastToAll }))
vi.mock('@/lib/feature-flags', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/feature-flags')>()),
  invalidateFeatureFlagCache: m.invalidateFeatureFlagCache,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    featureAccessRequest: { findMany: m.requestFindMany, findUnique: m.requestFindUnique },
    $transaction: async (fn: (tx: typeof m.tx) => unknown) => fn(m.tx),
    externalTaskLink: {
      findMany: m.taskLinkFindMany,
      findUnique: m.taskLinkFindUnique,
      findFirst: m.taskLinkFindFirst,
      upsert: m.taskLinkUpsert,
    },
    integration: { findUnique: m.integrationFindUnique },
  },
}))

import { GET as requestsGet, PUT as rawRequestsPut } from '@/app/api/admin/feature-requests/route'

// The route's return type admits undefined (its authorize() union); a real response is always returned.
const requestsPut = async (r: Request) => (await rawRequestsPut(r)) as Response
import { GET as adminsGet, POST as adminsPost } from '@/app/api/admin/analytics/admins/route'
import { GET as taskLinksGet, PUT as taskLinksPut } from '@/app/api/v1/sync/google/task-links/route'
import { AdminAuthError } from '@/lib/admin-auth'
import { UnauthorizedError } from '@/lib/api-auth-middleware'

const req = (url: string, method = 'GET', body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

beforeEach(() => {
  vi.clearAllMocks()
  m.getUnifiedSession.mockResolvedValue({ user: { id: 'admin-1' } })
  m.requireAdmin.mockResolvedValue(undefined)
  m.isAdmin.mockResolvedValue(true)
  m.broadcastToAll.mockResolvedValue(undefined)
})

describe('/api/admin/feature-requests (ADEV-293)', () => {
  it('401 without a session, 403 for a non-admin, on both methods', async () => {
    m.getUnifiedSession.mockResolvedValue(null)
    expect((await requestsGet(req('/api/admin/feature-requests'))).status).toBe(401)
    expect((await requestsPut(req('/api/admin/feature-requests', 'PUT', {}))).status).toBe(401)
    m.getUnifiedSession.mockResolvedValue({ user: { id: 'u' } })
    m.requireAdmin.mockRejectedValue(new AdminAuthError('Admin access required'))
    expect((await requestsGet(req('/api/admin/feature-requests'))).status).toBe(403)
    expect((await requestsPut(req('/api/admin/feature-requests', 'PUT', { requestId: 'r', decision: 'GRANTED' }))).status).toBe(403)
    expect(m.requestFindUnique).not.toHaveBeenCalled()
  })

  it('GET 400 for an unknown feature key', async () => {
    expect((await requestsGet(req('/api/admin/feature-requests?featureKey=%00bogus'))).status).toBe(400)
    expect(m.requestFindMany).not.toHaveBeenCalled()
  })

  it('PUT 400 for a bad decision and 404 for an unknown request', async () => {
    expect((await requestsPut(req('/api/admin/feature-requests', 'PUT', { requestId: 'r1', decision: 'MAYBE' }))).status).toBe(400)
    m.requestFindUnique.mockResolvedValue(null)
    expect((await requestsPut(req('/api/admin/feature-requests', 'PUT', { requestId: 'r1', decision: 'GRANTED' }))).status).toBe(404)
    expect(m.tx.featureAccessRequest.update).not.toHaveBeenCalled()
  })

  it('granting marks the request and adds an INCLUDE target in the same transaction', async () => {
    m.requestFindUnique.mockResolvedValue({ id: 'r1', userId: 'u2', featureKey: 'project_mode' })
    m.tx.featureAccessRequest.update.mockResolvedValue({ id: 'r1', status: 'GRANTED' })
    m.tx.featureFlag.findUnique.mockResolvedValue({ id: 'flag-1' })
    const res = await requestsPut(req('/api/admin/feature-requests', 'PUT', { requestId: 'r1', decision: 'GRANTED' }))
    expect(res.status).toBe(200)
    expect(m.tx.featureFlagTarget.upsert.mock.calls[0][0].create).toMatchObject({
      featureFlagId: 'flag-1',
      userId: 'u2',
      treatment: 'INCLUDE',
    })
    expect(m.tx.featureFlagTarget.deleteMany).not.toHaveBeenCalled()
    expect(m.invalidateFeatureFlagCache).toHaveBeenCalled()
  })

  it('declining revokes a previous INCLUDE', async () => {
    m.requestFindUnique.mockResolvedValue({ id: 'r1', userId: 'u2', featureKey: 'project_mode' })
    m.tx.featureAccessRequest.update.mockResolvedValue({ id: 'r1', status: 'DECLINED' })
    m.tx.featureFlag.findUnique.mockResolvedValue({ id: 'flag-1' })
    await requestsPut(req('/api/admin/feature-requests', 'PUT', { requestId: 'r1', decision: 'DECLINED' }))
    expect(m.tx.featureFlagTarget.deleteMany).toHaveBeenCalledWith({
      where: { featureFlagId: 'flag-1', userId: 'u2', treatment: 'INCLUDE' },
    })
    expect(m.tx.featureFlagTarget.upsert).not.toHaveBeenCalled()
  })

  it('a missing seeded flag fails the whole review instead of reporting success', async () => {
    m.requestFindUnique.mockResolvedValue({ id: 'r1', userId: 'u2', featureKey: 'project_mode' })
    m.tx.featureAccessRequest.update.mockResolvedValue({ id: 'r1' })
    m.tx.featureFlag.findUnique.mockResolvedValue(null)
    await expect(
      requestsPut(req('/api/admin/feature-requests', 'PUT', { requestId: 'r1', decision: 'GRANTED' })),
    ).rejects.toThrow(/Missing seeded feature flag/)
    expect(m.invalidateFeatureFlagCache).not.toHaveBeenCalled()
  })
})

describe('/api/admin/analytics/admins (ADEV-293)', () => {
  it('401 without a session, 403 for a non-admin', async () => {
    m.getUnifiedSession.mockResolvedValue(null)
    expect((await adminsGet()).status).toBe(401)
    expect((await adminsPost(req('/x', 'POST', { email: 'a@b.co' }))).status).toBe(401)
    m.getUnifiedSession.mockResolvedValue({ user: { id: 'u' } })
    m.isAdmin.mockResolvedValue(false)
    expect((await adminsGet()).status).toBe(403)
    expect((await adminsPost(req('/x', 'POST', { email: 'a@b.co' }))).status).toBe(403)
    expect(m.addAdminByEmail).not.toHaveBeenCalled()
  })

  it('GET lists admins with a total', async () => {
    m.listAdmins.mockResolvedValue([{ id: 'a' }, { id: 'b' }])
    expect(await (await adminsGet()).json()).toEqual({ admins: [{ id: 'a' }, { id: 'b' }], meta: { total: 2 } })
  })

  it('POST 400 without an email, 201 with one (lower-cased, attributed to the caller), 400 on an AdminAuthError', async () => {
    expect((await adminsPost(req('/x', 'POST', {}))).status).toBe(400)
    m.addAdminByEmail.mockResolvedValue({ id: 'new' })
    const res = await adminsPost(req('/x', 'POST', { email: 'New@Example.com' }))
    expect(res.status).toBe(201)
    expect(m.addAdminByEmail).toHaveBeenCalledWith('new@example.com', 'admin-1')
    m.addAdminByEmail.mockRejectedValue(new AdminAuthError('User not found'))
    expect((await adminsPost(req('/x', 'POST', { email: 'x@example.com' }))).status).toBe(400)
  })
})

describe('/api/v1/sync/google/task-links (ADEV-293)', () => {
  const auth = { userId: 'user-1', source: 'oauth' as const, scopes: ['*'], isAIAgent: false, user: { id: 'user-1' } }
  const url = '/api/v1/sync/google/task-links'
  const body = { astridTaskId: 't1', remoteId: 'g1', remoteContainerId: 'tl1' }
  const put = (b: unknown) => taskLinksPut(req(url, 'PUT', b), undefined as never)

  beforeEach(() => {
    m.authenticateAPI.mockResolvedValue(auth)
    m.requireScopes.mockReturnValue(undefined)
    m.requireTaskAccess.mockResolvedValue(undefined)
    m.integrationFindUnique.mockResolvedValue({ id: 'int-1', revokedAt: null })
    m.taskLinkFindUnique.mockResolvedValue(null)
    m.taskLinkUpsert.mockResolvedValue({ id: 'link-1' })
  })

  it('401 when unauthenticated', async () => {
    m.authenticateAPI.mockRejectedValue(new UnauthorizedError())
    expect((await taskLinksGet(req(url), undefined as never)).status).toBe(401)
    expect((await put(body)).status).toBe(401)
    expect(m.taskLinkUpsert).not.toHaveBeenCalled()
  })

  it("GET scopes the links to the caller and, for a list, to that list's tasks", async () => {
    m.taskLinkFindMany.mockResolvedValue([])
    await taskLinksGet(req(`${url}?listId=l1`), undefined as never)
    expect(m.taskLinkFindMany.mock.calls[0][0].where).toEqual({
      userId: 'user-1',
      provider: 'GOOGLE_TASKS',
      task: { lists: { some: { id: 'l1' } } },
    })
  })

  it('PUT 400 for missing fields, wrong types and an unsynced temp id', async () => {
    expect((await put({ astridTaskId: 't1' })).status).toBe(400)
    expect((await put({ ...body, remoteId: 5 })).status).toBe(400)
    expect((await put({ ...body, astridTaskId: 'temp_123' })).status).toBe(400)
    expect(m.taskLinkUpsert).not.toHaveBeenCalled()
  })

  it('PUT 404 for a task the caller cannot access (no task-id oracle)', async () => {
    m.requireTaskAccess.mockRejectedValue(new Error('Forbidden'))
    expect((await put(body)).status).toBe(404)
    expect(m.taskLinkUpsert).not.toHaveBeenCalled()
  })

  it('PUT 401 when Google is not connected', async () => {
    m.integrationFindUnique.mockResolvedValue(null)
    expect((await put(body)).status).toBe(401)
  })

  it('PUT merges metadata over the stored value', async () => {
    m.taskLinkFindUnique.mockResolvedValue({ metadata: { keep: 1, a: 0 } })
    expect((await put({ ...body, metadata: { a: 2 } })).status).toBe(200)
    expect(m.taskLinkUpsert.mock.calls[0][0].update.metadata).toEqual({ keep: 1, a: 2 })
  })

  it('PUT returns the existing row as adopted when another device linked the remote id first (P2002)', async () => {
    m.taskLinkUpsert.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }))
    m.taskLinkFindFirst.mockResolvedValue({ id: 'existing' })
    const res = await put(body)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ link: { id: 'existing' }, adopted: true })
  })
})
