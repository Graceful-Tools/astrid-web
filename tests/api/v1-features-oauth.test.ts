/**
 * Regression tests for AWTD-566 — iOS must be able to read its own feature
 * flags.
 *
 * /api/v1/features was session-only, so every OAuth request (i.e. every request
 * iOS makes) returned 401. Project Mode is granted per user by an admin, so the
 * phone had no way to discover whether the signed-in user has it and could not
 * gate the Projects UI on server config at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/feature-flags', () => ({
  getEffectiveFeatures: vi.fn(),
}))

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
    getDeprecationWarning: vi.fn(() => null),
    UnauthorizedError,
    ForbiddenError,
  }
})

import { GET } from '@/app/api/v1/features/route'
import { getEffectiveFeatures } from '@/lib/feature-flags'
import { authenticateAPI, UnauthorizedError } from '@/lib/api-auth-middleware'

const mockAuth = vi.mocked(authenticateAPI)
const mockFeatures = vi.mocked(getEffectiveFeatures)

const oauthCaller = {
  userId: 'ios-user',
  source: 'oauth' as const,
  scopes: ['tasks:read'],
  isAIAgent: false,
  user: { id: 'ios-user', email: 'jon@example.com', name: 'Jon', isAIAgent: false },
}

const req = (headers: Record<string, string> = {}) =>
  new NextRequest('http://localhost/api/v1/features', { method: 'GET', headers })

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(oauthCaller as never)
  mockFeatures.mockResolvedValue({ version: 7, features: { google_tasks: false, project_mode: true } } as never)
})

describe('GET /api/v1/features (AWTD-566)', () => {
  it('REGRESSION: an OAuth caller gets their flags, not a 401', async () => {
    // This is the whole fix. iOS authenticates with OAuth and used to get 401.
    const res = await GET(req(), {} as never)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.features.project_mode).toBe(true)
  })

  it('resolves flags for the AUTHENTICATED user, not a fixed one', async () => {
    await GET(req(), {} as never)
    expect(mockFeatures).toHaveBeenCalledWith('ios-user')
  })

  it('requires no scope, so an older token can still learn what it may do', async () => {
    // Gating this behind a scope would mean a token issued before that scope
    // existed could never discover the feature it is being granted.
    const narrow = { ...oauthCaller, scopes: [] }
    mockAuth.mockResolvedValue(narrow as never)
    expect((await GET(req(), {} as never)).status).toBe(200)
  })

  it('still 401s when unauthenticated', async () => {
    mockAuth.mockRejectedValue(new UnauthorizedError('no token'))
    expect((await GET(req(), {} as never)).status).toBe(401)
  })

  it('honours If-None-Match so the phone can poll cheaply', async () => {
    const first = await GET(req(), {} as never)
    const etag = first.headers.get('etag')!
    const second = await GET(req({ 'if-none-match': etag }), {} as never)
    expect(second.status).toBe(304)
  })

  it('changes the etag when a flag flips, or a client would cache a stale grant', async () => {
    const before = (await GET(req(), {} as never)).headers.get('etag')
    mockFeatures.mockResolvedValue({ version: 8, features: { google_tasks: false, project_mode: false } } as never)
    const after = (await GET(req(), {} as never)).headers.get('etag')
    expect(after).not.toBe(before)
  })

  it('never lets a per-user response into a shared cache', async () => {
    const res = await GET(req(), {} as never)
    expect(res.headers.get('cache-control')).toContain('private')
  })
})
