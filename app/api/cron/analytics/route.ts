/**
 * Analytics Aggregation Cron Job
 *
 * Runs daily at midnight PST (08:00 UTC) to aggregate the previous day's events
 * into AnalyticsDailyStats, and to expire rows nobody reads any more.
 *
 * GET /api/cron/analytics - Trigger aggregation (Vercel Cron)
 */

import { NextRequest, NextResponse } from 'next/server'
import { aggregateDailyStats } from '@/lib/analytics-events'
import { pruneDeletionLog } from '@/lib/deletion-log'
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

    // Housekeeping, after the aggregation that actually matters: DeletionLog
    // gets a tombstone per deleted task and list, and nothing expired them, so
    // the table grew forever and getDeletionsSince() scanned all of it
    // (AWTD-993). Safe at 30 days' retention because the web client forces a
    // FULL sync once no cursor is within MAX_CURSOR_AGE (24h, lib/data-sync.ts),
    // so no client asks for deletions older than the window. It reports its own
    // failures and returns 0 rather than failing the job above.
    const deletionTombstonesPruned = await pruneDeletionLog()

    return { date: yesterday.toISOString().split('T')[0], deletionTombstonesPruned }
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
