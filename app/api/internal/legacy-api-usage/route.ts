import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logger'
import { recordLegacyApiHit, getLegacyUsageReport } from '@/lib/legacy-api-usage-service'
import { detectPlatform } from '@/lib/analytics-events'
import { isAdmin } from '@/lib/admin-auth'
import { getUnifiedSession } from '@/lib/session-utils'

const log = createLogger('internal.legacy-api-usage')

/**
 * Durable census of legacy `/api/*` traffic (task 641a7615, re-landed for
 * task 058d80ad).
 *
 * POST — the beacon. The middleware runs in the edge runtime and cannot reach
 * Prisma, so it fires a fire-and-forget request here with the hit it just saw.
 * Fire-and-forget: the caller does not await, so this never adds latency to the
 * request being measured.
 *
 * Platform detection happens HERE, not in the middleware — that placement is
 * the whole reason the first landing died. detectPlatform lives in
 * analytics-events, which imports Prisma at module scope; importing it from
 * middleware put Prisma in the edge bundle and 500'd every request for ~12
 * minutes. The middleware now forwards the three signals detectPlatform reads
 * (user-agent, x-platform, and whether the request carried an OAuth bearer),
 * and this Node-side route does the classifying with the one shared
 * implementation.
 *
 * GET — the report. Traffic per route over a >=4-week window, broken down by
 * client, with an explicit safe-to-delete verdict that refuses to fire on thin
 * evidence. Admin only.
 *
 * This path is in `INTERNAL_PREFIXES`, so recording a legacy hit does not
 * itself count as one. Without that, every hit would generate a hit forever.
 */

const BeaconSchema = z.object({
  route: z.string().min(1).max(512),
  method: z.string().min(1).max(16),
  ua: z.string().max(1024).default(''),
  xPlatform: z.string().max(64).nullish(),
  /** Computed edge-side by string prefix — the raw token never leaves the request. */
  oauthBearer: z.boolean().default(false),
  /**
   * How many hits this beacon represents. The middleware samples 1 in N, so a
   * sampled beacon stands for N; the guaranteed first-hit-per-route stands for
   * 1. Counting every beacon as one would under-report by the sample rate.
   */
  weight: z.number().int().min(1).max(1000).default(1),
})

export async function POST(request: NextRequest) {
  const internalSecret = request.headers.get('X-Internal-Secret')
  const expectedSecret = process.env.INTERNAL_API_SECRET

  if (!expectedSecret || internalSecret !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = BeaconSchema.parse(await request.json())

    // A headers-shim carrying the forwarded signals, so detectPlatform's one
    // implementation classifies beacon hits exactly like direct ones. The
    // authorization value is synthetic on purpose: detectPlatform only tests
    // the `Bearer astrid_` prefix, and the beacon must not carry real tokens.
    const forwarded = new Headers({ 'user-agent': parsed.ua })
    if (parsed.xPlatform) forwarded.set('x-platform', parsed.xPlatform)
    if (parsed.oauthBearer) forwarded.set('authorization', 'Bearer astrid_forwarded')

    const platform = detectPlatform({ headers: forwarded } as NextRequest)

    await recordLegacyApiHit({
      route: parsed.route,
      method: parsed.method,
      platform,
      weight: parsed.weight,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    // Telemetry must never be load-bearing. Log and return 200 so a malformed
    // beacon cannot produce error noise that looks like a real incident.
    log.warn({ err }, 'malformed legacy-api-usage beacon')
    return NextResponse.json({ ok: false })
  }
}

export async function GET(request: NextRequest) {
  const session = await getUnifiedSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!(await isAdmin(session.user.id))) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  const windowDays = Number(request.nextUrl.searchParams.get('windowDays')) || undefined
  const report = await getLegacyUsageReport({ windowDays })

  return NextResponse.json(report)
}
