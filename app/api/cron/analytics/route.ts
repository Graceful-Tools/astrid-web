/**
 * Analytics Aggregation Cron Job
 *
 * Runs daily at midnight PST (08:00 UTC) to aggregate the previous day's events
 * into AnalyticsDailyStats, and to expire telemetry nobody reads any more.
 *
 * GET /api/cron/analytics - Trigger aggregation (Vercel Cron)
 */

import { NextRequest, NextResponse } from 'next/server'
import { aggregateDailyStats } from '@/lib/analytics-events'
import { pruneWebVitalSamples } from '@/lib/web-vitals-service'
import { ensureInitialAdmin } from '@/lib/admin-auth'
import { createLogger } from '@/lib/logger'
import { requireCronSecret } from '@/lib/cron-auth'
import { runCronJob } from '@/lib/cron-observability'

const log = createLogger('cron.analytics')


export async function GET(request: NextRequest) {
  // Fails CLOSED: no CRON_SECRET configured means nobody gets in.
  const blocked = requireCronSecret(request)
  if (blocked) return blocked

  return runCronJob('analytics', async () => {
    // Yesterday in UTC. Running at 08:00 UTC, that is the previous PST day.
    const now = new Date()
    const yesterday = new Date(now)
    yesterday.setUTCDate(yesterday.getUTCDate() - 1)
    yesterday.setUTCHours(0, 0, 0, 0)

    await aggregateDailyStats(yesterday)

    // Idempotent.
    await ensureInitialAdmin()

    // Housekeeping, after the aggregation that actually matters: WebVitalSample
    // gets a row per page view and the report reads a fixed window, so without
    // this the table grows forever (AWTD-990). It reports its own failures and
    // returns 0 rather than failing the job above.
    const webVitalSamplesPruned = await pruneWebVitalSamples()

    return { date: yesterday.toISOString().split('T')[0], webVitalSamplesPruned }
  })
}

// Also support POST for manual triggering in development
export async function POST(request: NextRequest) {
  // Only allow in development
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not allowed in production' }, { status: 403 })
  }

  return GET(request)
}
