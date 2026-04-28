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

vi.mock('@/lib/oauth/oauth-client-manager', () => ({
  listUserOAuthClients: vi.fn(),
  createOAuthClient: vi.fn(),
  getOAuthClient: vi.fn(),
  updateOAuthClient: vi.fn(),
  deleteOAuthClient: vi.fn(),
  regenerateClientSecret: vi.fn(),
}))

import { GET as LIST, POST as CREATE } from '@/app/api/v1/oauth/clients/route'
import { GET as GET_ONE, PUT, DELETE } from '@/app/api/v1/oauth/clients/[clientId]/route'
import { POST as REGEN } from '@/app/api/v1/oauth/clients/[clientId]/regenerate-secret/route'
import { authenticateAPI, UnauthorizedError } from '@/lib/api-auth-middleware'
import {
  listUserOAuthClients,
  createOAuthClient,
  getOAuthClient,
  updateOAuthClient,
  deleteOAuthClient,
  regenerateClientSecret,
} from '@/lib/oauth/oauth-client-manager'

const mockAuth = vi.mocked(authenticateAPI)
const mockList = vi.mocked(listUserOAuthClients)
const mockCreate = vi.mocked(createOAuthClient)
const mockGetOne = vi.mocked(getOAuthClient)
const mockUpdate = vi.mocked(updateOAuthClient)
const mockDelete = vi.mocked(deleteOAuthClient)
const mockRegen = vi.mocked(regenerateClientSecret)

const authedUser = {
  userId: 'user-1',
  source: 'session' as const,
  scopes: ['*'],
  isAIAgent: false,
  user: { id: 'user-1', email: 'jon@example.com', name: 'Jon', isAIAgent: false },
}

function makeReq(method: string, url: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

const params = Promise.resolve({ clientId: 'client-1' })

describe('GET /api/v1/oauth/clients', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(authedUser as any)
  })

  it('returns 401 when authentication fails', async () => {
    mockAuth.mockRejectedValueOnce(new UnauthorizedError('No session'))
    const res = await LIST(
      makeReq('GET', 'http://localhost/api/v1/oauth/clients'),
      undefined as any
    )
    expect(res.status).toBe(401)
  })

  it('lists clients for the authenticated user', async () => {
    mockList.mockResolvedValue([
      { clientId: 'c-1', name: 'App 1' } as any,
      { clientId: 'c-2', name: 'App 2' } as any,
    ])
    const res = await LIST(
      makeReq('GET', 'http://localhost/api/v1/oauth/clients'),
      undefined as any
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.clients).toHaveLength(2)
    expect(json.meta.total).toBe(2)
    expect(mockList).toHaveBeenCalledWith('user-1')
  })
})

describe('POST /api/v1/oauth/clients', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(authedUser as any)
  })

  it('returns 400 when name is missing', async () => {
    const res = await CREATE(
      makeReq('POST', 'http://localhost/api/v1/oauth/clients', {}),
      undefined as any
    )
    expect(res.status).toBe(400)
  })

  it('creates a client and includes the warning string', async () => {
    mockCreate.mockResolvedValue({
      clientId: 'new-id',
      clientSecret: 'new-secret',
      name: 'My App',
    } as any)

    const res = await CREATE(
      makeReq('POST', 'http://localhost/api/v1/oauth/clients', {
        name: 'My App',
        scopes: ['tasks:read'],
      }),
      undefined as any
    )
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.client.clientSecret).toBe('new-secret')
    expect(json.warning).toContain('not be shown again')
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My App', userId: 'user-1' })
    )
  })
})

describe('GET /api/v1/oauth/clients/:clientId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(authedUser as any)
  })

  it('returns 404 when client does not exist', async () => {
    mockGetOne.mockResolvedValue(null as any)
    const res = await GET_ONE(makeReq('GET', 'http://localhost/x'), { params } as any)
    expect(res.status).toBe(404)
  })

  it('returns 403 when client belongs to another user', async () => {
    mockGetOne.mockResolvedValue({ clientId: 'client-1', userId: 'someone-else' } as any)
    const res = await GET_ONE(makeReq('GET', 'http://localhost/x'), { params } as any)
    expect(res.status).toBe(403)
  })

  it('returns the client when caller owns it', async () => {
    mockGetOne.mockResolvedValue({ clientId: 'client-1', userId: 'user-1', name: 'App' } as any)
    const res = await GET_ONE(makeReq('GET', 'http://localhost/x'), { params } as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.client.clientId).toBe('client-1')
  })
})

describe('PUT /api/v1/oauth/clients/:clientId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(authedUser as any)
  })

  it('returns 404 when underlying manager throws not-found', async () => {
    mockUpdate.mockRejectedValue(new Error('OAuth client not found'))
    const res = await PUT(
      makeReq('PUT', 'http://localhost/x', { name: 'New' }),
      { params } as any
    )
    expect(res.status).toBe(404)
  })

  it('updates and returns the client', async () => {
    mockUpdate.mockResolvedValue({ clientId: 'client-1', name: 'New', userId: 'user-1' } as any)
    const res = await PUT(
      makeReq('PUT', 'http://localhost/x', { name: 'New' }),
      { params } as any
    )
    expect(res.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith(
      'client-1',
      'user-1',
      expect.objectContaining({ name: 'New' })
    )
  })
})

describe('DELETE /api/v1/oauth/clients/:clientId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(authedUser as any)
  })

  it('returns 404 when delete returns false (not found / not owned)', async () => {
    mockDelete.mockResolvedValue(false as any)
    const res = await DELETE(makeReq('DELETE', 'http://localhost/x'), { params } as any)
    expect(res.status).toBe(404)
  })

  it('returns success when client is deleted', async () => {
    mockDelete.mockResolvedValue(true as any)
    const res = await DELETE(makeReq('DELETE', 'http://localhost/x'), { params } as any)
    expect(res.status).toBe(200)
    expect(mockDelete).toHaveBeenCalledWith('client-1', 'user-1')
  })
})

describe('POST /api/v1/oauth/clients/:clientId/regenerate-secret', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(authedUser as any)
  })

  it('returns 404 when underlying manager throws not-found', async () => {
    mockRegen.mockRejectedValue(new Error('OAuth client not found'))
    const res = await REGEN(makeReq('POST', 'http://localhost/x'), { params } as any)
    expect(res.status).toBe(404)
  })

  it('returns the new secret on success', async () => {
    mockRegen.mockResolvedValue('brand-new-secret-123' as any)
    const res = await REGEN(makeReq('POST', 'http://localhost/x'), { params } as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.clientSecret).toBe('brand-new-secret-123')
    expect(json.warning).toContain('Old secret is now invalid')
    expect(mockRegen).toHaveBeenCalledWith('client-1', 'user-1')
  })
})
