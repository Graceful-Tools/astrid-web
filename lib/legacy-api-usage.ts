import type { AnalyticsPlatformValue } from '@/lib/analytics-events'

/**
 * Durable telemetry for the legacy `/api/*` surface (task 641a7615).
 *
 * `lib/api-deprecation.ts` already emits `{"deprecation":"legacy-api",...}` on
 * every legacy hit. That was meant to make the retirement data-driven — "when
 * residual traffic on a route drops to zero, the route is safe to delete."
 *
 * It can't, because **Vercel's runtime logs retain a window of minutes**. The
 * best census anyone has managed is ~2 minutes / 136 lines. Acceptance asks for
 * a **≥4-week** window broken down by route × client. In the task's own words,
 * anything less is *"a guess wearing a data-driven costume."*
 *
 * So the counts have to live in our own database. This module is the pure half:
 * how a hit is bucketed, and how a window of buckets answers the only question
 * that matters — *is this route safe to delete yet?*
 *
 * Deliberately NOT here: the write path (`lib/legacy-api-usage-service.ts`,
 * which needs Prisma) and the beacon route. This file stays importable from the
 * edge runtime.
 */

/**
 * Where the middleware beacons a hit. Must be excluded from
 * `isLegacyApiPath` — recording a legacy hit is itself an `/api/*` request, so
 * if it counted, every hit would generate a hit forever.
 */
export const LEGACY_USAGE_BEACON_PATH = '/api/internal/legacy-api-usage'

/** The observation window the acceptance criteria demand. */
export const REQUIRED_OBSERVATION_DAYS = 28

/** `/api/auth/[...nextauth]` is NextAuth's mount point. It can never be deleted. */
const NEVER_DELETABLE = ['/api/auth/']

/** Opaque id segments, so `/api/lists/<uuid>` aggregates as one route. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CUID = /^c[a-z0-9]{20,}$/i
const NUMERIC = /^\d+$/

export interface LegacyUsageBucket {
  day: Date
  route: string
  method: string
  platform: string
}

/**
 * Collapse id segments out of a path.
 *
 * Without this, every task id is its own row and "how much traffic does
 * /api/tasks still get?" is unanswerable — you would be counting thousands of
 * distinct routes, none of which individually looks like traffic.
 */
export function normalizeLegacyRoute(pathname: string): string {
  return pathname
    .split('/')
    .map(segment =>
      UUID.test(segment) || CUID.test(segment) || NUMERIC.test(segment)
        ? ':id'
        : segment,
    )
    .join('/')
}

/**
 * The (day, route, method, client) key a hit accumulates into.
 *
 * The day is UTC midnight so a "day" means the same thing regardless of where
 * the request came from — otherwise the daily counts drift against each other
 * and a 4-week window has fuzzy edges.
 */
export function legacyUsageBucket(args: {
  route: string
  method: string
  platform: AnalyticsPlatformValue | string
  at: Date
}): LegacyUsageBucket {
  const day = new Date(args.at)
  day.setUTCHours(0, 0, 0, 0)

  return {
    day,
    route: normalizeLegacyRoute(args.route),
    method: args.method,
    platform: String(args.platform),
  }
}

export interface LegacyUsageRow {
  route: string
  method: string
  platform: string
  day: Date
  count: number
}

export interface LegacyRouteSummary {
  route: string
  /** Hits across the whole retained history, not just the window. */
  total: number
  /** Last day this route was seen at all — what "zero traffic since" means. */
  lastSeen: Date | null
  byClient: Record<string, number>
  /**
   * True only when the window is genuinely empty AND we have been observing
   * long enough for that emptiness to mean anything.
   */
  safeToDelete: boolean
  reason: string
}

/**
 * Roll daily buckets up into the per-route verdict the task's acceptance
 * criteria are written against.
 *
 * The bar is deliberately hard to clear. A route is only `safeToDelete` when:
 *
 * 1. it is not the NextAuth mount, and
 * 2. no traffic landed inside the window, and
 * 3. we have been *observing* since before the window opened — otherwise
 *    "no traffic in the last 4 weeks" is indistinguishable from "we only
 *    started counting yesterday", which is exactly the mistake that made the
 *    original 2-minute sample look like evidence.
 */
export function summarizeLegacyUsage(
  rows: LegacyUsageRow[],
  options: { now: Date; windowStart?: Date; observingSince?: Date },
): LegacyRouteSummary[] {
  const windowStart =
    options.windowStart ??
    new Date(options.now.getTime() - REQUIRED_OBSERVATION_DAYS * 24 * 60 * 60 * 1000)

  const byRoute = new Map<string, LegacyUsageRow[]>()
  for (const row of rows) {
    const existing = byRoute.get(row.route)
    if (existing) existing.push(row)
    else byRoute.set(row.route, [row])
  }

  const observedDays = options.observingSince
    ? (options.now.getTime() - options.observingSince.getTime()) / (24 * 60 * 60 * 1000)
    : 0
  const windowDays =
    (options.now.getTime() - windowStart.getTime()) / (24 * 60 * 60 * 1000)

  return Array.from(byRoute.entries()).map(([route, routeRows]) => {
    const total = routeRows.reduce((sum, r) => sum + r.count, 0)

    const seen = routeRows.filter(r => r.count > 0)
    const lastSeen = seen.length
      ? new Date(Math.max(...seen.map(r => r.day.getTime())))
      : null

    const byClient: Record<string, number> = {}
    for (const row of routeRows) {
      byClient[row.platform] = (byClient[row.platform] ?? 0) + row.count
    }

    const inWindow = seen.filter(r => r.day.getTime() >= windowStart.getTime())

    let safeToDelete = false
    let reason: string

    if (NEVER_DELETABLE.some(prefix => route.startsWith(prefix))) {
      reason = 'never deletable — NextAuth mount point, web session auth runs through it'
    } else if (inWindow.length > 0) {
      const hits = inWindow.reduce((sum, r) => sum + r.count, 0)
      reason = `${hits} hit(s) inside the window; last seen ${lastSeen?.toISOString().slice(0, 10)}`
    } else if (observedDays < windowDays) {
      reason =
        `insufficient observation — the window is ${Math.round(windowDays)}d but ` +
        `telemetry has only been durable for ${Math.round(observedDays)}d. ` +
        'An empty window here means "not measured", not "no traffic".'
    } else {
      safeToDelete = true
      reason = lastSeen
        ? `no traffic since ${lastSeen.toISOString().slice(0, 10)}, across a ${Math.round(windowDays)}d window`
        : `no traffic ever recorded, across a ${Math.round(windowDays)}d window`
    }

    return { route, total, lastSeen, byClient, safeToDelete, reason }
  })
}
