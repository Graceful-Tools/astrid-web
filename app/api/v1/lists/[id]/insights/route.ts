/**
 * List insights API v1 (AWTD-1329)
 *
 * GET /api/v1/lists/:id/insights?days=30&tz=America/Los_Angeles
 *
 * New and completed tasks per day, the median time from create to complete,
 * the median stay in each board lane (boards only), and the top contributors —
 * over the last `days` (7, 30 or 90; default 30) calendar days in `tz` (an IANA
 * zone; default UTC). The response is `{ insights: ListInsights }`, the shape
 * in lib/list-insights.ts, and it is the contract every platform renders: the
 * history it is computed from lives only on the server.
 *
 * Anyone who can view the list may read it.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import {
  DEFAULT_INSIGHT_WINDOW_DAYS,
  INSIGHT_WINDOW_DAYS,
  isValidTimeZone,
  type InsightWindowDays,
} from '@/lib/list-insights'
import { loadListInsights } from '@/services/list-insights.service'
import { createRateLimitHeaders, insightsRateLimiter } from '@/lib/rate-limiter'

type RouteContext = { params: Promise<{ id: string }> }

function parseDays(value: string | null): InsightWindowDays | null {
  if (value === null) return DEFAULT_INSIGHT_WINDOW_DAYS
  const days = Number(value)
  return (INSIGHT_WINDOW_DAYS as readonly number[]).includes(days) ? (days as InsightWindowDays) : null
}

export const GET = withAuth<RouteContext>(
  { scopes: ['lists:read'], tag: 'v1.lists.insights' },
  async (req, auth, { params }) => {
    const { id } = await params
    const url = new URL(req.url)

    // Per-user budget, checked before any database work (AWTD-1367). A cold answer
    // walks the list's history, and the cache key includes the viewer's zone and day,
    // so looping windows, zones or lists bypasses the cache by design.
    const rate = await insightsRateLimiter.checkRateLimitByKeyAsync(`insights:${auth.userId}`)
    const rateHeaders = createRateLimitHeaders(rate)
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Too many insight requests. Please try again shortly.' },
        {
          status: 429,
          headers: { ...rateHeaders, 'Retry-After': rateHeaders['X-RateLimit-Reset-After'] },
        },
      )
    }

    const days = parseDays(url.searchParams.get('days'))
    if (days === null) {
      return NextResponse.json(
        { error: `days must be one of ${INSIGHT_WINDOW_DAYS.join(', ')}` },
        { status: 400 },
      )
    }
    const timeZone = url.searchParams.get('tz') || 'UTC'
    if (!isValidTimeZone(timeZone)) {
      return NextResponse.json({ error: `Unknown time zone: ${timeZone}` }, { status: 400 })
    }

    const insights = await loadListInsights(id, auth.userId, { days, timeZone })
    // A list the caller cannot see answers exactly like one that does not exist.
    if (!insights) {
      return NextResponse.json({ error: 'List not found' }, { status: 404 })
    }

    return NextResponse.json({ insights }, { headers: rateHeaders })
  },
)
