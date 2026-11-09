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

vi.mock('@/lib/oauth/oauth-client-manager', () => {
  // A real class, because the route narrows on `instanceof` rather than
  // sniffing the message — mocking it as a plain vi.fn() would make every
  // typed branch fall through to the 500 catch-all.
  class UnknownScopeGroupError extends Error {
    constructor(readonly group: string) {
      super(`Unknown scope group: ${group}`)
      this.name = 'UnknownScopeGroupError'
    }
  }
  return {
    listUserOAuthClients: vi.fn(),
    createOAuthClient: vi.fn(),
    getOAuthClient: vi.fn(),
    updateOAuthClient: vi.fn(),
    deleteOAuthClient: vi.fn(),
    regenerateClientSecret: vi.fn(),
    adoptClientScopeGroup: vi.fn(),
    UnknownScopeGroupError,
  }
})

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
  adoptClientScopeGroup,
  UnknownScopeGroupError,
} from '@/lib/oauth/oauth-client-manager'

const mockAuth = vi.mocked(authenticateAPI)
const mockList = vi.mocked(listUserOAuthClients)
const mockCreate = vi.mocked(createOAuthClient)
const mockGetOne = vi.mocked(getOAuthClient)
const mockUpdate = vi.mocked(updateOAuthClient)
const mockDelete = vi.mocked(deleteOAuthClient)
const mockRegen = vi.mocked(regenerateClientSecret)
const mockAdopt = vi.mocked(adoptClientScopeGroup)

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

  it('builds a preset client from the preset, not the body: scopes, grant, and the group it follows', async () => {
    mockCreate.mockResolvedValue({ clientId: 'new-id', clientSecret: 'new-secret' } as any)

    const res = await CREATE(
      makeReq('POST', 'http://localhost/api/v1/oauth/clients', {
        preset: 'githubActions',
        agent: 'copilot',
        // A caller may not smuggle its own scopes in beside a preset.
        scopes: ['tasks:delete'],
        grantTypes: ['authorization_code'],
      }),
      undefined as any
    )
    expect(res.status).toBe(201)
    const call = mockCreate.mock.calls[0][0]
    expect(call.userId).toBe('user-1')
    expect(call.name).toMatch(/GitHub Actions/)
    expect(call.name).toContain('copilot')
    expect(call.grantTypes).toEqual(['client_credentials'])
    expect(call.scopeGroup).toBe('ai_agent')
    expect(call.scopes).not.toContain('tasks:delete')
    expect(call.scopes).toContain('tasks:read')
  })

  it('rejects an unknown preset as a bad request', async () => {
    const res = await CREATE(
      makeReq('POST', 'http://localhost/api/v1/oauth/clients', { preset: 'nope', agent: 'claude' }),
      undefined as any
    )
    expect(res.status).toBe(400)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('rejects a preset without a known agent identity', async () => {
    const res = await CREATE(
      makeReq('POST', 'http://localhost/api/v1/oauth/clients', { preset: 'githubActions', agent: 'root' }),
      undefined as any
    )
    expect(res.status).toBe(400)
    expect(mockCreate).not.toHaveBeenCalled()
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

/**
 * Adopting a connection into a scope group is how an EXISTING client gains
 * scopes without a hand-written UPDATE against production (AWTD-962). It
 * widens privileges, so what it refuses matters more than what it allows.
 */
describe('PUT /api/v1/oauth/clients/:clientId — scope group adoption (AWTD-962)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(authedUser as any)
    mockAdopt.mockResolvedValue({
      changed: true,
      added: ['chat:read', 'chat:write'],
      client: { clientId: 'client-1', scopeGroup: 'ai_agent' },
    } as any)
  })

  it('adopts the client and reports which scopes it gained', async () => {
    const res = await PUT(
      makeReq('PUT', 'http://localhost/x', { scopeGroup: 'ai_agent' }),
      { params } as any
    )

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.added).toEqual(['chat:read', 'chat:write'])
    expect(json.client.scopeGroup).toBe('ai_agent')
    expect(mockAdopt).toHaveBeenCalledWith('client-1', 'user-1', 'ai_agent')
  })

  it('does not write the ordinary fields when the body only adopts', async () => {
    await PUT(
      makeReq('PUT', 'http://localhost/x', { scopeGroup: 'ai_agent' }),
      { params } as any
    )

    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('refuses a delegated token: a narrow OAuth token must not self-escalate', async () => {
    mockAuth.mockResolvedValue({ ...authedUser, source: 'oauth', scopes: ['tasks:read'] } as any)

    const res = await PUT(
      makeReq('PUT', 'http://localhost/x', { scopeGroup: 'ai_agent' }),
      { params } as any
    )

    expect(res.status).toBe(403)
    expect(mockAdopt).not.toHaveBeenCalled()
  })

  it('rejects an unrecognised group as a bad request, not a server error', async () => {
    mockAdopt.mockRejectedValue(new UnknownScopeGroupError('not_a_group'))

    const res = await PUT(
      makeReq('PUT', 'http://localhost/x', { scopeGroup: 'not_a_group' }),
      { params } as any
    )

    expect(res.status).toBe(400)
  })

  it('still 404s when the caller does not own the client', async () => {
    mockAdopt.mockRejectedValue(new Error('OAuth client not found or access denied'))

    const res = await PUT(
      makeReq('PUT', 'http://localhost/x', { scopeGroup: 'ai_agent' }),
      { params } as any
    )

    expect(res.status).toBe(404)
  })

  it('leaves a plain field update alone — no adoption, no session requirement', async () => {
    mockAuth.mockResolvedValue({ ...authedUser, source: 'oauth' } as any)
    mockUpdate.mockResolvedValue({ clientId: 'client-1', name: 'New' } as any)

    const res = await PUT(
      makeReq('PUT', 'http://localhost/x', { name: 'New' }),
      { params } as any
    )

    expect(res.status).toBe(200)
    expect(mockAdopt).not.toHaveBeenCalled()
  })
})

/**
 * Granular scope editing from Settings → Connections (AWTD-1513). The editor
 * sends the exact scope set the owner ticked; the server is the only judge of
 * what is a real, registerable scope — never the browser.
 */
describe('PUT /api/v1/oauth/clients/:clientId — granular scopes (AWTD-1513)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(authedUser as any)
    mockUpdate.mockResolvedValue({ clientId: 'client-1', scopes: ['tasks:read'], scopeGroup: null } as any)
  })

  it('AWTD-1513: rejects an unknown scope with 400 and writes nothing', async () => {
    const res = await PUT(
      makeReq('PUT', 'http://localhost/x', { scopes: ['tasks:read', 'tasks:teleport'] }),
      { params } as any
    )

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('tasks:teleport')
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('AWTD-1513: rejects the wildcard — it is never registerable', async () => {
    const res = await PUT(
      makeReq('PUT', 'http://localhost/x', { scopes: ['*'] }),
      { params } as any
    )

    expect(res.status).toBe(400)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('AWTD-1513: rejects an empty or malformed scope list', async () => {
    for (const scopes of [[], 'tasks:read', [42]]) {
      const res = await PUT(makeReq('PUT', 'http://localhost/x', { scopes }), { params } as any)
      expect(res.status).toBe(400)
    }
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('AWTD-1513: rejects names inherited from Object.prototype', async () => {
    for (const bad of ['toString', '__proto__', 'constructor']) {
      const res = await PUT(makeReq('PUT', 'http://localhost/x', { scopes: ['tasks:read', bad] }), { params } as any)
      expect(res.status).toBe(400)
    }
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('AWTD-1513: a non-string entry that cannot be stringified is still a 400, not a 500', async () => {
    const res = await PUT(
      makeReq('PUT', 'http://localhost/x', { scopes: [{ toString: null }] }),
      { params } as any
    )
    expect(res.status).toBe(400)
  })

  it('AWTD-1513: persists exactly the granular set it was sent', async () => {
    const scopes = ['tasks:read', 'lists:read', 'lists:configure']
    const res = await PUT(makeReq('PUT', 'http://localhost/x', { scopes }), { params } as any)

    expect(res.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith('client-1', 'user-1', expect.objectContaining({ scopes }))
  })

  it('AWTD-1513: changing scopes needs an interactive session, like adoption', async () => {
    mockAuth.mockResolvedValue({ ...authedUser, source: 'oauth', scopes: ['tasks:read'] } as any)

    const res = await PUT(
      makeReq('PUT', 'http://localhost/x', { scopes: ['tasks:read', 'tasks:delete'] }),
      { params } as any
    )

    expect(res.status).toBe(403)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('AWTD-1513: scopeGroup null stops following a group', async () => {
    const res = await PUT(
      makeReq('PUT', 'http://localhost/x', { scopes: ['tasks:read'], scopeGroup: null }),
      { params } as any
    )

    expect(res.status).toBe(200)
    expect(mockAdopt).not.toHaveBeenCalled()
    expect(mockUpdate).toHaveBeenCalledWith(
      'client-1',
      'user-1',
      expect.objectContaining({ scopes: ['tasks:read'], scopeGroup: null })
    )
  })

  it('AWTD-1513: scopes plus a group writes the set, then adopts the group', async () => {
    mockAdopt.mockResolvedValue({ changed: false, added: [], client: { clientId: 'client-1' } } as any)

    const res = await PUT(
      makeReq('PUT', 'http://localhost/x', { scopes: ['tasks:read'], scopeGroup: 'ai_agent' }),
      { params } as any
    )

    expect(res.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith('client-1', 'user-1', expect.objectContaining({ scopes: ['tasks:read'] }))
    expect(mockAdopt).toHaveBeenCalledWith('client-1', 'user-1', 'ai_agent')
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

/**
 * AWTD-1539: regenerating a secret, deleting a client, or repointing it reaches
 * the same escalation as registering one — a leaked narrow-scope token could
 * regenerate a broader client_credentials client's secret and mint its scopes.
 * Each needs an interactive session, like client creation.
 */
describe('OAuth client credential changes need an interactive session (AWTD-1539)', () => {
  const delegated = { ...authedUser, source: 'oauth', scopes: ['tasks:read'] }

  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(delegated as any)
  })

  it('AWTD-1539: regenerate-secret refuses an OAuth token', async () => {
    const res = await REGEN(makeReq('POST', 'http://localhost/x'), { params } as any)
    expect(res.status).toBe(403)
    expect(mockRegen).not.toHaveBeenCalled()
  })

  it('AWTD-1539: DELETE refuses an OAuth token', async () => {
    const res = await DELETE(makeReq('DELETE', 'http://localhost/x'), { params } as any)
    expect(res.status).toBe(403)
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it.each([
    ['redirectUris', { redirectUris: ['https://evil.example/cb'] }],
    ['isActive', { isActive: false }],
  ])('AWTD-1539: PUT changing %s refuses an OAuth token', async (_field, body) => {
    const res = await PUT(makeReq('PUT', 'http://localhost/x', body), { params } as any)
    expect(res.status).toBe(403)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('AWTD-1539: a session can still regenerate, delete and repoint', async () => {
    mockAuth.mockResolvedValue(authedUser as any)
    mockRegen.mockResolvedValue('s' as any)
    mockDelete.mockResolvedValue(true as any)
    mockUpdate.mockResolvedValue({ clientId: 'client-1' } as any)
    expect((await REGEN(makeReq('POST', 'http://localhost/x'), { params } as any)).status).toBe(200)
    expect((await DELETE(makeReq('DELETE', 'http://localhost/x'), { params } as any)).status).toBe(200)
    expect((await PUT(makeReq('PUT', 'http://localhost/x', { isActive: false }), { params } as any)).status).toBe(200)
  })
})
