import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logger'
import { recordWebVitalSample } from '@/lib/web-vitals-service'
import { detectPlatform } from '@/lib/analytics-events'
import { webVitalsRateLimiter, createRateLimitHeaders } from '@/lib/rate-limiter'
import { normalizeVitalsRoute, WEB_VITAL_METRICS, AUTH_STATES } from '@/lib/web-vitals'

const log = createLogger('internal.web-vitals')

/**
 * Core Web Vitals ingest (AWTD-904).
 *
 * POST only, and deliberately **unauthenticated**: LCP is worst and matters
 * most for logged-out visitors, so a session requirement would blind the
 * metric exactly where the budget is about to be missed. What protects it
 * instead is that it accepts nothing worth forging — three enumerated metric
 * names, a bounded number, a normalised route, and an opaque per-tab id — and
 * a per-IP rate limit.
 *
 * `authState` comes from the client because the client is the only thing that
 * knows whether the page it just measured was rendered for a signed-in user.
 * It is a two-value flag, never an identity: there is no userId on this table.
 *
 * Why not Speed Insights: it stays mounted and keeps thirteen months of
 * history, but it is dashboard-only — every candidate REST endpoint 404s — so
 * nothing can script its p75 into PERFORMANCE_BUDGETS.md. This path exists to
 * make the number readable by a command, not to replace that collector.
 */

const SampleSchema = z.object({
  metric: z.enum(WEB_VITAL_METRICS),
  value: z.number().finite(),
  /** The page path as the browser saw it; normalised server-side. */
  path: z.string().min(1).max(2048),
  authState: z.enum(AUTH_STATES),
  /** Opaque, generated in the browser, never a database session id. */
  sessionId: z.string().min(1).max(64),
})

export async function POST(request: NextRequest) {
  const limit = await webVitalsRateLimiter.checkRateLimitAsync(request)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      { status: 429, headers: createRateLimitHeaders(limit) },
    )
  }

  try {
    const parsed = SampleSchema.parse(await request.json())

    await recordWebVitalSample({
      metric: parsed.metric,
      value: parsed.value,
      route: normalizeVitalsRoute(parsed.path),
      platform: detectPlatform(request),
      authState: parsed.authState,
      sessionId: parsed.sessionId,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    // Telemetry must never be load-bearing. Log and answer 200 so a malformed
    // beacon cannot generate error noise that reads like a real incident —
    // the same rule the legacy-API beacon follows.
    log.warn({ err }, 'malformed web-vitals beacon')
    return NextResponse.json({ ok: false })
  }
}
