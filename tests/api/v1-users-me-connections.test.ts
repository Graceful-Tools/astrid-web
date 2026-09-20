/**
 * GET/DELETE /api/v1/users/me/connections — everything that can act as the
 * account, and a way to stop it.
 *
 * The consent page has promised for months that an authorised app can be
 * "revoked from Settings → API Access". There was no endpoint behind the
 * promise: the revoke helpers in oauth-token-manager had no callers, and
 * consent-authorised clients appeared on no settings screen at all. This is
 * the endpoint the promise needed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api-auth-middleware', () => {
  class UnauthorizedError extends Error {
    constructor(msg = 'Unauthorized') { super(msg); this.name = 'UnauthorizedError' }
  }
  class ForbiddenError extends Error {
    constructor(msg = 'Forbidden') { super(msg); this.name = 'ForbiddenError' }
  }
  return {
    authenticateAPI: vi.fn(),
    requireScopes: vi.fn(),
    UnauthorizedError,
    ForbiddenError,
    getDeprecationWarning: vi.fn(() => null),
  }
})

const listMock = vi.hoisted(() => vi.fn())
const revokeMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/connections/list-connections', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/connections/list-connections')>()),
  listConnections: listMock,
}))
vi.mock('@/lib/connections/revoke-connection', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/connections/revoke-connection')>()),
  revokeConnection: revokeMock,
}))

import { GET } from '@/app/api/v1/users/me/connections/route'
import { DELETE } from '@/app/api/v1/users/me/connections/[kind]/[id]/route'
import { authenticateAPI, UnauthorizedError } from '@/lib/api-auth-middleware'
import { ConnectionNotFoundError } from '@/lib/connections/revoke-connection'

const mockAuth = vi.mocked(authenticateAPI)

const session = {
  userId: 'user-1',
  source: 'session' as const,
  scopes: ['*'],
  isAIAgent: false,
  user: { id: 'user-1', email: 'jon@example.com', name: 'Jon', isAIAgent: false },
}

const req = (method: string, url: string) => new NextRequest(url, { method })
const ctx = (kind: string, id: string) => ({ params: Promise.resolve({ kind, id }) })

describe('GET /api/v1/users/me/connections', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(session as any)
  })

  it('401s without authentication', async () => {
    mockAuth.mockRejectedValueOnce(new UnauthorizedError())
    const res = await GET(req('GET', 'http://localhost/api/v1/users/me/connections'), undefined as any)
    expect(res.status).toBe(401)
  })

  it('returns every connection the helper found, under the v1 envelope', async () => {
    listMock.mockResolvedValue([
      { id: 'c1', kind: 'oauthClient', name: 'My script' },
      { id: 'dcr-1', kind: 'authorizedApp', name: 'Claude Code' },
      { id: 'agent-1', kind: 'customAgent', name: 'nightly' },
      { id: 'tok-1', kind: 'accessToken', name: 'GitHub Copilot cloud agent' },
      { id: 'webhook', kind: 'webhook', name: 'hooks.example.test' },
    ])
    const res = await GET(req('GET', 'http://localhost/api/v1/users/me/connections'), undefined as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.connections.map((c: { kind: string }) => c.kind)).toEqual([
      'oauthClient', 'authorizedApp', 'customAgent', 'accessToken', 'webhook',
    ])
    expect(json.meta).toEqual({ apiVersion: 'v1', authSource: 'session', total: 5 })
    expect(listMock).toHaveBeenCalledWith('user-1')
  })
})

describe('DELETE /api/v1/users/me/connections/:kind/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(session as any)
  })

  it('refuses a delegated token: a leaked credential must not revoke its siblings', async () => {
    mockAuth.mockResolvedValue({ ...session, source: 'oauth', scopes: ['user:write'] } as any)
    const res = await DELETE(
      req('DELETE', 'http://localhost/api/v1/users/me/connections/authorizedApp/dcr-1'),
      ctx('authorizedApp', 'dcr-1')
    )
    expect(res.status).toBe(403)
    expect(revokeMock).not.toHaveBeenCalled()
  })

  it('rejects an unknown kind as a bad request', async () => {
    const res = await DELETE(
      req('DELETE', 'http://localhost/api/v1/users/me/connections/sessions/x'),
      ctx('sessions', 'x')
    )
    expect(res.status).toBe(400)
    expect(revokeMock).not.toHaveBeenCalled()
  })

  it('404s when the connection is not the caller\'s', async () => {
    revokeMock.mockRejectedValue(new ConnectionNotFoundError('accessToken', 'tok-9'))
    const res = await DELETE(
      req('DELETE', 'http://localhost/api/v1/users/me/connections/accessToken/tok-9'),
      ctx('accessToken', 'tok-9')
    )
    expect(res.status).toBe(404)
  })

  it('revokes as the session user and reports what it did', async () => {
    revokeMock.mockResolvedValue({ kind: 'authorizedApp', id: 'dcr-1', revokedTokens: 2 })
    const res = await DELETE(
      req('DELETE', 'http://localhost/api/v1/users/me/connections/authorizedApp/dcr-1'),
      ctx('authorizedApp', 'dcr-1')
    )
    expect(res.status).toBe(200)
    expect(revokeMock).toHaveBeenCalledWith('user-1', 'authorizedApp', 'dcr-1')
    const json = await res.json()
    expect(json).toEqual({
      success: true,
      kind: 'authorizedApp',
      id: 'dcr-1',
      revokedTokens: 2,
      meta: { apiVersion: 'v1', authSource: 'session' },
    })
  })
})
