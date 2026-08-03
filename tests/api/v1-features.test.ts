import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// The route moved from session-only auth to withAuth, which accepts an OAuth
// token as well as a session — without that, iOS could never read its own
// flags (AWTD-566). These tests follow it to the new auth path; the web
// session case is unchanged in behaviour and still covered below.
vi.mock('@/lib/feature-flags', () => ({ getEffectiveFeatures: vi.fn() }))
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

/** A web session caller, as withAuth reports one. */
const sessionCaller = (userId: string) => ({
  userId, source: 'session' as const, scopes: ['*'], isAIAgent: false,
  user: { id: userId, email: 'u@example.com', name: null, isAIAgent: false },
})

describe('GET /api/v1/features', () => {
  beforeEach(() => vi.clearAllMocks())

  it('requires authentication', async () => {
    mockAuth.mockRejectedValue(new UnauthorizedError('no session'))
    const response = await GET(new NextRequest('http://localhost/api/v1/features') as never, {} as never)
    expect(response.status).toBe(401)
  })

  it('returns only effective values for the current user', async () => {
    mockAuth.mockResolvedValue(sessionCaller('user-1') as never)
    mockFeatures.mockResolvedValue({ version: 42, features: { google_tasks: false } })
    const response = await GET(new NextRequest('http://localhost/api/v1/features') as never, {} as never)
    expect(await response.json()).toEqual({ version: 42, features: { google_tasks: false } })
    expect(mockFeatures).toHaveBeenCalledWith('user-1')
  })

  it('uses ETags to avoid sending unchanged configuration', async () => {
    mockAuth.mockResolvedValue(sessionCaller('user-1') as never)
    mockFeatures.mockResolvedValue({ version: 42, features: { google_tasks: false } })
    const first = await GET(new NextRequest('http://localhost/api/v1/features') as never, {} as never)
    const etag = first.headers.get('etag')!
    const second = await GET(new NextRequest('http://localhost/api/v1/features', { headers: { 'If-None-Match': etag } }))
    expect(second.status).toBe(304)
  })
})
