/**
 * Analytics Aggregation Cron Job
 *
 * Runs daily at midnight PST (08:00 UTC) to aggregate the previous day's events
 * into AnalyticsDailyStats.
 *
 * GET /api/cron/analytics - Trigger aggregation (Vercel Cron)
 */

import { NextRequest, NextResponse } from 'next/server'
import { aggregateDailyStats } from '@/lib/analytics-events'
import { ensureInitialAdmin } from '@/lib/admin-auth'
import { createLogger } from '@/lib/logger'
import { requireCronSecret } from '@/lib/cron-auth'

const log = createLogger('cron.analytics')


export async function GET(request: NextRequest) {
  const startTime = Date.now()

  try {
    // Verify Vercel cron secret (if configured)
    // Fails CLOSED: no CRON_SECRET configured means nobody gets in.
    const blocked = requireCronSecret(request)
    if (blocked) return blocked

    // Get yesterday's date (PST = UTC-8)
    // When this runs at 08:00 UTC, it's midnight PST
    // We want to aggregate the previous day's data
    const now = new Date()
    const yesterday = new Date(now)
    yesterday.setUTCDate(yesterday.getUTCDate() - 1)
    yesterday.setUTCHours(0, 0, 0, 0)

    log.info(`[Analytics Cron] Aggregating stats for ${yesterday.toISOString().split('T')[0]}`)

    // Aggregate yesterday's stats
    await aggregateDailyStats(yesterday)

    // Also ensure admin user exists (idempotent)
    await ensureInitialAdmin()

    const duration = Date.now() - startTime

    return NextResponse.json({
      success: true,
      date: yesterday.toISOString().split('T')[0],
      duration: `${duration}ms`,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    log.error({ err: error }, '[Analytics Cron] Error:')
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: `${Date.now() - startTime}ms`,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    )
  }
}

// Also support POST for manual triggering in development
export async function POST(request: NextRequest) {
  // Only allow in development
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not allowed in production' }, { status: 403 })
  }

  return GET(request)
}
