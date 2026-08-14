/**
 * RED for task e0613ae5 — the public-lists pair disagrees about `limit`, and
 * both spellings reach Prisma's `take` unchecked.
 *
 *   legacy GET /api/lists/public      parseInt(limit ?? '10')            no cap
 *   v1     GET /api/v1/public/lists   Math.min(parseInt(limit ?? '50'), 100)
 *
 * Two problems, one of them live on both sides:
 *
 * 1. legacy has NO upper bound. `?limit=1000000` becomes `take: 1000000` on a
 *    public, unauthenticated-in-spirit listing endpoint with four web callers.
 *
 * 2. BOTH mishandle a non-numeric limit. parseInt('abc') is NaN, and
 *    Math.min(NaN, 100) is also NaN, so v1's cap does not rescue it — `take:
 *    NaN` goes to Prisma and the request fails as a 500 rather than a 400.
 *
 * This is the same shape as the chat-pagination limit already fixed on this
 * task, which is why it is worth closing rather than noting: the pattern
 * recurs, and each instance is a cheap query away from being expensive.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/session-utils', () => ({ getUnifiedSession: vi.fn() }))

vi.mock('@/lib/api-auth-middleware', () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    authenticateAPI: vi.fn(),
    requireScopes: vi.fn(),
    UnauthorizedError,
    ForbiddenError,
    getDeprecationWarning: vi.fn(() => null),
  }
})

const getPopularPublicLists = vi.hoisted(() => vi.fn(async () => []))
const getRecentPublicLists = vi.hoisted(() => vi.fn(async () => []))
const searchPublicLists = vi.hoisted(() => vi.fn(async () => []))
vi.mock('@/lib/copy-utils', () => ({
  getPopularPublicLists, getRecentPublicLists, searchPublicLists,
}))

vi.mock('@/lib/redis', () => ({
  RedisCache: {
    // Pass through so the assertion is about the limit, not the cache.
    getOrSet: vi.fn(async (_k: string, f: () => unknown) => f()),
    del: vi.fn(), delPattern: vi.fn(async () => undefined),
    keys: {}, invalidate: {},
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { taskList: { findMany: vi.fn(async () => []) } },
}))

import { GET as legacyGET } from '@/app/api/lists/public/route'
import { getUnifiedSession } from '@/lib/session-utils'

const mockSession = vi.mocked(getUnifiedSession)

function req(qs: string) {
  return new NextRequest(`http://localhost/api/lists/public${qs}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSession.mockResolvedValue({ user: { id: 'user-1' } } as never)
  getPopularPublicLists.mockResolvedValue([] as never)
  getRecentPublicLists.mockResolvedValue([] as never)
  searchPublicLists.mockResolvedValue([] as never)
})

/** The limit the route actually passed downstream. */
function limitPassedToPopular() {
  return getPopularPublicLists.mock.calls[0][0]
}

describe('legacy GET /api/lists/public caps the limit (task e0613ae5)', () => {
  it('refuses to ask for a million rows', async () => {
    await legacyGET(req('?limit=1000000'))

    expect(limitPassedToPopular()).toBeLessThanOrEqual(100)
  })

  it('caps at the same 100 v1 uses, so the two agree', async () => {
    await legacyGET(req('?limit=250'))

    expect(limitPassedToPopular()).toBe(100)
  })

  it('leaves a reasonable limit alone', async () => {
    await legacyGET(req('?limit=25'))

    expect(limitPassedToPopular()).toBe(25)
  })

  it('keeps its own default of 10 when none is given', async () => {
    // Deliberately NOT changed to v1's 50: four web callers rely on this
    // endpoint's current page size, and widening it silently is a behaviour
    // change dressed as a fix.
    await legacyGET(req(''))

    expect(limitPassedToPopular()).toBe(10)
  })
})

describe('a non-numeric limit does not reach the query (task e0613ae5)', () => {
  it('falls back to the default rather than passing NaN', async () => {
    // parseInt('abc') is NaN, and Math.min(NaN, 100) is NaN too — so a cap
    // alone never fixed this. NaN in Prisma's `take` fails the request.
    await legacyGET(req('?limit=abc'))

    const passed = limitPassedToPopular()
    expect(Number.isNaN(passed)).toBe(false)
    expect(passed).toBe(10)
  })

  it('treats a negative limit as the default too', async () => {
    await legacyGET(req('?limit=-5'))

    expect(limitPassedToPopular()).toBeGreaterThan(0)
  })
})
