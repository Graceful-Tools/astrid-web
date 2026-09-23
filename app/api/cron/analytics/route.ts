/**
 * Analytics Aggregation Cron Job
 *
 * Runs daily at midnight PST (08:00 UTC) to aggregate the previous day's events
 * into AnalyticsDailyStats, and to expire rows nobody reads any more.
 * into AnalyticsDailyStats, and to expire telemetry nobody reads any more.
 *
 * GET /api/cron/analytics - Trigger aggregation (Vercel Cron)
 */

import { NextRequest, NextResponse } from 'next/server'
import { aggregateDailyStats } from '@/lib/analytics-events'
import { pruneDeletionLog } from '@/lib/deletion-log'
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

    // Housekeeping, after the aggregation that actually matters. Both prunes
    // report their own failures and return 0 rather than failing the job above.
    //
    // DeletionLog gets a tombstone per deleted task and list, and nothing
    // expired them, so the table grew forever and getDeletionsSince() scanned
    // all of it (AWTD-993). Safe at 30 days' retention because both incremental
    // clients force a FULL sync once their cursor is older than
    // SYNC_CURSOR_MAX_AGE_MS (24h, lib/sync-cursor-age.ts), so no client asks
    // for deletions older than the window.
    const deletionTombstonesPruned = await pruneDeletionLog()

    // WebVitalSample gets a row per page view and the report reads a fixed
    // window, so without this the table grows forever (AWTD-990).
    const webVitalSamplesPruned = await pruneWebVitalSamples()

    return {
      date: yesterday.toISOString().split('T')[0],
      deletionTombstonesPruned,
      webVitalSamplesPruned,
    }
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
