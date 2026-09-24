/**
 * The admin analytics API carries the cache section (AWTD-905).
 *
 * Jon: "Add this to the analytics page so we can see latency per period."
 *
 * Which decides the delivery for a metric that had been unreadable for two
 * weeks: the page already has an admin gate, a date-range selector and a fetch,
 * so the cache numbers ride on all three rather than growing a fourth surface.
 *
 * The two properties worth pinning are the ones that would make the section
 * lie: it must be summarized over THE SAME range as everything else on the
 * page, and it must be behind the same admin check as the usage data — cache
 * hit rates and lambda counts are infrastructure detail.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const getUnifiedSession = vi.fn()
const isAdmin = vi.fn()
const getAnalyticsStats = vi.fn()
const getEventCountsByPlatform = vi.fn()
const getCacheMetricsReport = vi.fn()

vi.mock('@/lib/session-utils', () => ({ getUnifiedSession: () => getUnifiedSession() }))
vi.mock('@/lib/admin-auth', () => ({ isAdmin: (...a: unknown[]) => isAdmin(...a) }))
vi.mock('@/lib/analytics-events', () => ({
  getAnalyticsStats: (...a: unknown[]) => getAnalyticsStats(...a),
  getEventCountsByPlatform: (...a: unknown[]) => getEventCountsByPlatform(...a),
  ANALYTICS_PLATFORM_ORDER: [],
  ANALYTICS_EVENT_ORDER: [],
}))
vi.mock('@/lib/cache-metrics-service', () => ({
  getCacheMetricsReport: (...a: unknown[]) => getCacheMetricsReport(...a),
}))

const { GET } = await import('@/app/api/admin/analytics/route')

const emptyReport = {
  totals: {
    hits: 0,
    misses: 0,
    lookups: 0,
    loads: 0,
    coalesced: 0,
    errors: 0,
    windows: 0,
    instances: 0,
    hitRate: null,
    meanLookupMs: null,
    meanLoadMs: null,
  },
  byDay: [],
  retentionDays: 97,
}

// A neutral host: the route only parses the query string, and a test that named
// the brand's domain would assert the wrong one in a partner build
// (tests/rules/tests-do-not-hardcode-the-brand-domain.test.ts).
const request = (query = '') =>
  new Request(`https://test.local/api/admin/analytics${query}`) as never

beforeEach(() => {
  vi.clearAllMocks()
  getUnifiedSession.mockResolvedValue({ user: { id: 'admin-1' } })
  isAdmin.mockResolvedValue(true)
  getAnalyticsStats.mockResolvedValue([])
  getEventCountsByPlatform.mockResolvedValue({
    byPlatform: {},
    totalsByEvent: {},
    totalsByPlatform: {},
  })
  getCacheMetricsReport.mockResolvedValue(emptyReport)
})

describe('GET /api/admin/analytics — cache section (AWTD-905)', () => {
  it('returns the cache report alongside the usage stats', async () => {
    getCacheMetricsReport.mockResolvedValue({
      ...emptyReport,
      totals: { ...emptyReport.totals, hits: 800, misses: 200, lookups: 1000, hitRate: 80, meanLookupMs: 2.4, meanLoadMs: 180 },
      byDay: [{ date: '2026-09-22', hitRate: 80, meanLookupMs: 2.4, meanLoadMs: 180, lookups: 1000 }],
    })

    const body = await (await GET(request())).json()

    expect(body.cache.totals.hitRate).toBe(80)
    expect(body.cache.totals.meanLookupMs).toBe(2.4)
    expect(body.cache.byDay).toHaveLength(1)
  })

  it('summarizes the cache over the same range the rest of the page uses', async () => {
    await GET(request('?startDate=2026-09-01&endDate=2026-09-07'))

    const [{ startDate, endDate }] = getCacheMetricsReport.mock.calls[0]
    const [statsStart, statsEnd] = getAnalyticsStats.mock.calls[0]

    // Not "roughly the same period". A cache rate over a different window than
    // the traffic it is next to invites exactly the wrong conclusion.
    expect(startDate).toEqual(statsStart)
    expect(endDate).toEqual(statsEnd)
  })

  it('does not hand the cache report to a non-admin', async () => {
    isAdmin.mockResolvedValue(false)

    const response = await GET(request())

    expect(response.status).toBe(403)
    expect(getCacheMetricsReport).not.toHaveBeenCalled()
  })

  it('does not hand the cache report to an anonymous caller', async () => {
    getUnifiedSession.mockResolvedValue(null)

    const response = await GET(request())

    expect(response.status).toBe(401)
    expect(getCacheMetricsReport).not.toHaveBeenCalled()
  })
})
