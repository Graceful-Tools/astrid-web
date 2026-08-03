import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import {
  legacyUsageBucket,
  summarizeLegacyUsage,
  REQUIRED_OBSERVATION_DAYS,
  type LegacyRouteSummary,
} from '@/lib/legacy-api-usage'

const log = createLogger('legacy-api-usage')

/**
 * Write path for the legacy-traffic census (task 641a7615). Separate from
 * `lib/legacy-api-usage.ts` so that module stays edge-importable — this one
 * needs Prisma.
 */

/**
 * Accumulate one legacy hit into its daily bucket.
 *
 * **Best-effort by contract.** This is telemetry for a migration; it must never
 * turn a user's request into an error. Callers do not await it for correctness.
 */
export async function recordLegacyApiHit(args: {
  route: string
  method: string
  platform: string
  at?: Date
}): Promise<void> {
  const bucket = legacyUsageBucket({
    route: args.route,
    method: args.method,
    platform: args.platform,
    at: args.at ?? new Date(),
  })

  try {
    await prisma.legacyApiDailyUsage.upsert({
      where: {
        day_route_method_platform: {
          day: bucket.day,
          route: bucket.route,
          method: bucket.method,
          platform: bucket.platform,
        },
      },
      create: { ...bucket, count: 1 },
      update: { count: { increment: 1 } },
    })
  } catch (err) {
    // Swallow: a telemetry write must not fail the request it is describing.
    log.warn({ err, route: bucket.route }, 'failed to record legacy api hit')
  }
}

/**
 * The date durable observation began — the earliest bucket we hold.
 *
 * This is what stops "no traffic in the window" being confused with "we only
 * started counting yesterday", which is the exact error that made a 2-minute
 * sample look like evidence.
 */
export async function legacyObservingSince(): Promise<Date | null> {
  const earliest = await prisma.legacyApiDailyUsage.findFirst({
    orderBy: { day: 'asc' },
    select: { day: true },
  })
  return earliest?.day ?? null
}

/**
 * The per-route verdict the task's acceptance criteria are written against:
 * traffic over a >=4-week window, broken down by client, and an explicit
 * safe-to-delete call that refuses to fire on thin evidence.
 */
export async function getLegacyUsageReport(options?: {
  now?: Date
  windowDays?: number
}): Promise<{
  windowStart: Date
  observingSince: Date | null
  observedDays: number
  routes: LegacyRouteSummary[]
}> {
  const now = options?.now ?? new Date()
  const windowDays = options?.windowDays ?? REQUIRED_OBSERVATION_DAYS
  const windowStart = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000)

  const [rows, observingSince] = await Promise.all([
    prisma.legacyApiDailyUsage.findMany({
      select: { route: true, method: true, platform: true, day: true, count: true },
    }),
    legacyObservingSince(),
  ])

  const routes = summarizeLegacyUsage(rows, {
    now,
    windowStart,
    observingSince: observingSince ?? undefined,
  })

  // Loudest first: the routes with the most residual traffic are the ones
  // still blocking the sunset.
  routes.sort((a, b) => b.total - a.total)

  return {
    windowStart,
    observingSince,
    observedDays: observingSince
      ? Math.floor((now.getTime() - observingSince.getTime()) / (24 * 60 * 60 * 1000))
      : 0,
    routes,
  }
}
