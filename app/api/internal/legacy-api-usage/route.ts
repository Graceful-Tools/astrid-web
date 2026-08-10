import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logger'
import { recordLegacyApiHit, getLegacyUsageReport } from '@/lib/legacy-api-usage-service'
import { isAdmin } from '@/lib/admin-auth'
import { getUnifiedSession } from '@/lib/session-utils'

const log = createLogger('internal.legacy-api-usage')

/**
 * Durable census of legacy `/api/*` traffic (task 641a7615).
 *
 * POST — the beacon. The middleware runs in the edge runtime and cannot reach
 * Prisma, so it fires a fire-and-forget request here with the hit it just saw.
 * Fire-and-forget: the caller does not await, so this never adds latency to the
 * request being measured.
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
  platform: z.string().min(1).max(64),
})

export async function POST(request: NextRequest) {
  const internalSecret = request.headers.get('X-Internal-Secret')
  const expectedSecret = process.env.INTERNAL_API_SECRET

  if (!expectedSecret || internalSecret !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = BeaconSchema.parse(await request.json())
    await recordLegacyApiHit(parsed)
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
