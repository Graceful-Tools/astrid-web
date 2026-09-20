import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import {
  UnauthorizedError,
  ForbiddenError,
  type AuthContext,
} from '@/lib/api-auth-middleware'

vi.mock('@/lib/api-auth-middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-auth-middleware')>(
    '@/lib/api-auth-middleware'
  )
  return {
    ...actual,
    authenticateAPI: vi.fn(),
    requireScopes: vi.fn(),
  }
})

import {
  authenticateAPI,
  requireScopes,
} from '@/lib/api-auth-middleware'
import { buildAuthContext } from '@/tests/fixtures/auth'

const FAKE_AUTH: AuthContext = buildAuthContext({
  userId: 'u1',
  source: 'oauth',
  scopes: ['tasks:read'],
  isAIAgent: false,
  user: { id: 'u1', email: 'u@example.com', name: 'U', isAIAgent: false },
})

function fakeReq() {
  // Minimal NextRequest-like shape for the wrapper's purposes.
  return {
    nextUrl: { pathname: '/api/test' },
  } as any
}

/**
 * Shadow enforcement for access tokens (MCPToken rows). The middleware grants
 * them '*' and also reports `shadowScopes`; the wrapper logs every call that
 * the shadow scopes would have refused, so the switch to real enforcement is
 * made on evidence rather than hope.
 */
describe('withAuth — access-token shadow scopes', () => {
  const warn = vi.fn()
  beforeEach(() => {
    warn.mockReset()
    vi.mocked(requireScopes).mockReturnValue(undefined)
  })

  function legacyAuth(shadowScopes: string[]): AuthContext {
    return buildAuthContext({
      userId: 'u1',
      source: 'legacy_mcp',
      scopes: ['*'],
      shadowScopes,
      isAIAgent: false,
      user: { id: 'u1', email: 'u@example.com', name: 'U', isAIAgent: false },
    })
  }

  it('warns when the route needs a scope the mapped permissions lack, and still serves it', async () => {
    vi.mocked(authenticateAPI).mockResolvedValue(legacyAuth(['tasks:read', 'tasks:write']))
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }))
    const route = withAuth({ scopes: ['tasks:delete'], tag: 'test.shadow', onShadowDenied: warn }, handler)

    const res = await route(fakeReq(), {})

    expect(res.status).toBe(200)
    expect(handler).toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/api/test', needed: ['tasks:delete'], shadowScopes: ['tasks:read', 'tasks:write'] })
    )
  })

  it('stays quiet when the mapped permissions cover the route', async () => {
    vi.mocked(authenticateAPI).mockResolvedValue(legacyAuth(['tasks:read', 'tasks:write']))
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }))
    const route = withAuth({ scopes: ['tasks:read'], tag: 'test.shadow', onShadowDenied: warn }, handler)

    await route(fakeReq(), {})

    expect(warn).not.toHaveBeenCalled()
  })

  it('never fires for OAuth or session callers, which have real scopes already', async () => {
    vi.mocked(authenticateAPI).mockResolvedValue(FAKE_AUTH)
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }))
    const route = withAuth({ scopes: ['tasks:delete'], tag: 'test.shadow', onShadowDenied: warn }, handler)

    await route(fakeReq(), {})

    expect(warn).not.toHaveBeenCalled()
  })
})

describe('withAuth', () => {
  beforeEach(() => {
    vi.mocked(authenticateAPI).mockResolvedValue(FAKE_AUTH)
    vi.mocked(requireScopes).mockReturnValue(undefined)
  })
  afterEach(() => vi.clearAllMocks())

  it('passes auth context to the handler on success', async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }))
    const route = withAuth({}, handler)
    const res = await route(fakeReq(), {})
    expect(handler).toHaveBeenCalledWith(expect.anything(), FAKE_AUTH, {})
    expect(res.status).toBe(200)
  })

  it('returns 401 on UnauthorizedError from authenticateAPI', async () => {
    vi.mocked(authenticateAPI).mockRejectedValueOnce(new UnauthorizedError('no token'))
    const handler = vi.fn()
    const route = withAuth({}, handler)
    const res = await route(fakeReq(), {})
    expect(res.status).toBe(401)
    expect(handler).not.toHaveBeenCalled()
  })

  it('returns 403 on ForbiddenError from requireScopes', async () => {
    vi.mocked(requireScopes).mockImplementationOnce(() => {
      throw new ForbiddenError('missing scope')
    })
    const handler = vi.fn()
    const route = withAuth({ scopes: ['admin:write'] }, handler)
    const res = await route(fakeReq(), {})
    expect(res.status).toBe(403)
    expect(handler).not.toHaveBeenCalled()
  })

  it('skips scope check when scopes option is omitted', async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }))
    const route = withAuth({}, handler)
    await route(fakeReq(), {})
    expect(requireScopes).not.toHaveBeenCalled()
  })

  it('returns 401 when handler throws UnauthorizedError', async () => {
    const handler = vi.fn().mockRejectedValue(new UnauthorizedError('inner'))
    const route = withAuth({}, handler)
    const res = await route(fakeReq(), {})
    expect(res.status).toBe(401)
  })

  it('returns 403 when handler throws ForbiddenError', async () => {
    const handler = vi.fn().mockRejectedValue(new ForbiddenError('inner'))
    const route = withAuth({}, handler)
    const res = await route(fakeReq(), {})
    expect(res.status).toBe(403)
  })

  it('returns 500 when handler throws unexpected error', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const handler = vi.fn().mockRejectedValue(new Error('oops'))
    const route = withAuth({}, handler)
    const res = await route(fakeReq(), {})
    expect(res.status).toBe(500)
    errSpy.mockRestore()
  })

  it('forwards the route context to the handler unchanged (dynamic routes)', async () => {
    const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }))
    const route = withAuth<{ params: Promise<{ id: string }> }>({}, handler)
    const ctx = { params: Promise.resolve({ id: 'task-123' }) }
    await route(fakeReq(), ctx)
    expect(handler).toHaveBeenCalledWith(expect.anything(), FAKE_AUTH, ctx)
  })
})
