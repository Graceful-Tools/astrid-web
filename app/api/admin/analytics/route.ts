/**
 * Admin Analytics API
 *
 * GET /api/admin/analytics - Get analytics stats
 */

import { type NextRequest, NextResponse } from 'next/server'
import { getUnifiedSession } from '@/lib/session-utils'
import { isAdmin } from '@/lib/admin-auth'
import {
  getAnalyticsStats,
  getEventCountsByPlatform,
  ANALYTICS_PLATFORM_ORDER,
  ANALYTICS_EVENT_ORDER,
} from '@/lib/analytics-events'
import { getCacheMetricsReport } from '@/lib/cache-metrics-service'
import { createLogger } from '@/lib/logger'

const log = createLogger('admin.analytics')


/**
 * GET /api/admin/analytics
 * Get aggregated analytics stats for a date range
 *
 * Query parameters:
 * - startDate: ISO date string (default: 30 days ago)
 * - endDate: ISO date string (default: today)
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getUnifiedSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check admin access
    const admin = await isAdmin(session.user.id)
    if (!admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    // Parse query parameters
    const url = new URL(req.url)
    const endDateParam = url.searchParams.get('endDate')
    const startDateParam = url.searchParams.get('startDate')

    // Default to last 30 days
    const endDate = endDateParam ? new Date(endDateParam) : new Date()
    endDate.setUTCHours(23, 59, 59, 999)

    const startDate = startDateParam
      ? new Date(startDateParam)
      : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000)
    startDate.setUTCHours(0, 0, 0, 0)

    // Get stats + per-interface (platform) event breakdown over the range, plus
    // the Redis cache's own numbers for the SAME range (AWTD-905). Same range
    // deliberately: a hit rate summarized over a different window than the
    // traffic beside it invites exactly the wrong conclusion.
    const [stats, eventsByPlatform, cache] = await Promise.all([
      getAnalyticsStats(startDate, endDate),
      getEventCountsByPlatform(startDate, endDate),
      getCacheMetricsReport({ startDate, endDate }),
    ])

    // Calculate current metrics (most recent day with data)
    const latestStats = stats.length > 0 ? stats[stats.length - 1] : null
    const previousStats = stats.length > 1 ? stats[stats.length - 2] : null

    // Calculate % changes
    const calculateChange = (current: number, previous: number | null) => {
      if (previous === null || previous === 0) return null
      return Math.round(((current - previous) / previous) * 100)
    }

    return NextResponse.json({
      stats,
      summary: latestStats
        ? {
            date: latestStats.date,
            dau: latestStats.dau,
            wau: latestStats.wau,
            mau: latestStats.mau,
            dauChange: calculateChange(latestStats.dau, previousStats?.dau ?? null),
            wauChange: calculateChange(latestStats.wau, previousStats?.wau ?? null),
            mauChange: calculateChange(latestStats.mau, previousStats?.mau ?? null),
            platformBreakdown: {
              'web-desktop': latestStats.dauWebDesktop,
              'web-iPhone': latestStats.dauWebIPhone,
              'web-android': latestStats.dauWebAndroid,
              'iOS-app': latestStats.dauIOSApp,
              'mac-app': latestStats.dauMacApp,
              'API-other': latestStats.dauAPIOther,
              unknown: latestStats.dauUnknown,
            },
            eventCounts: {
              taskCreated: latestStats.taskCreated,
              taskEdited: latestStats.taskEdited,
              taskCompleted: latestStats.taskCompleted,
              taskDeleted: latestStats.taskDeleted,
              commentAdded: latestStats.commentAdded,
              commentDeleted: latestStats.commentDeleted,
              listAdded: latestStats.listAdded,
              listEdited: latestStats.listEdited,
              listDeleted: latestStats.listDeleted,
              settingsUpdated: latestStats.settingsUpdated,
            },
          }
        : null,
      // All event metrics broken down by interface (web / mobile web / iOS / …)
      // aggregated across the selected range.
      eventsByPlatform: {
        ...eventsByPlatform,
        platformOrder: ANALYTICS_PLATFORM_ORDER,
        eventOrder: ANALYTICS_EVENT_ORDER,
      },
      // Redis cache hit rate and MEAN latencies per day. Means, not
      // percentiles: the stored windows are summed durations, and no percentile
      // is recoverable from a sum (AWTD-905).
      cache,
      meta: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        totalDays: stats.length,
      },
    })
  } catch (error) {
    log.error({ err: error }, '[Admin Analytics] GET error:')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
