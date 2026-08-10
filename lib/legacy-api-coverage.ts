/**
 * Which legacy routes can actually be retired, and what stands in the way.
 * (Task 641a7615, step 4)
 *
 * Step 4 is "delete per-route as traffic hits zero", and answering that needs
 * two facts per route that nothing currently tracks together: does a v1
 * successor exist, and does any client still call the legacy path.
 *
 * I got both wrong by hand. Twice in one session I reported a resource as
 * having no v1 successor when it had full coverage — `/api/secure-files` and
 * `/api/chat`, whose v1 mounts are re-exports of the very handlers I said were
 * unmigratable. Both times the error came from inferring the answer instead of
 * looking, and both times it hid the *easiest* remaining work.
 *
 * So this derives the map from the filesystem rather than from memory. The
 * classification is the useful part: it separates "waiting on evidence" from
 * "waiting on a decision", which are the two very different reasons a route is
 * still here.
 *
 * In-scope is decided by `isLegacyApiPath`, deliberately reused rather than
 * re-derived — it already encodes the internal prefixes and the permanent auth
 * exemptions, and a census that disagreed with the telemetry about what counts
 * would be worse than no census.
 */

import { isLegacyApiPath } from './api-deprecation'

export type RouteStatus =
  /** Not part of the retirement: internal infrastructure, or permanently exempt. */
  | 'out-of-scope'
  /** Successor exists, no client calls the legacy path. Delete once traffic is zero. */
  | 'awaiting-traffic-evidence'
  /** Successor exists but clients still call legacy. Migration work remains. */
  | 'callers-remain'
  /** No successor and nothing calls it. Can likely just be deleted. */
  | 'unused-no-successor'
  /** No successor and clients depend on it. Needs a successor-or-exempt decision. */
  | 'needs-decision'

export interface RouteCoverage {
  /** e.g. `/api/lists/[id]` */
  apiPath: string
  /** e.g. `/api/v1/lists/[id]` */
  v1Path: string
  hasV1: boolean
  callerCount: number
  status: RouteStatus
}

/** `app/api/lists/[id]/route.ts` → `/api/lists/[id]` */
export function routeFileToApiPath(file: string): string {
  const normalized = file.replace(/\\/g, '/')
  const match = normalized.match(/(?:^|\/)app(\/api\/.*)\/route\.tsx?$/)
  if (match) return match[1]
  // A route file directly at app/api/route.ts has no trailing segment.
  return normalized.replace(/(?:^|\/)app/, '').replace(/\/route\.tsx?$/, '')
}

/** `/api/lists/[id]` → `/api/v1/lists/[id]` */
export function v1PathFor(apiPath: string): string {
  return apiPath.replace(/^\/api\//, '/api/v1/')
}

export function classifyRoute(args: {
  apiPath: string
  hasV1: boolean
  callerCount: number
}): RouteStatus {
  const { apiPath, hasV1, callerCount } = args

  // Ask the same question the telemetry asks. `isLegacyApiPath` wants a
  // pathname; a dynamic segment like `[id]` is inert for its prefix checks.
  if (!isLegacyApiPath(apiPath)) return 'out-of-scope'

  if (hasV1) {
    return callerCount > 0 ? 'callers-remain' : 'awaiting-traffic-evidence'
  }
  return callerCount > 0 ? 'needs-decision' : 'unused-no-successor'
}

/**
 * Turn a route path into a matcher for the URL literals a client would write.
 * `[id]` becomes one path segment; `[...rest]` becomes the remainder.
 */
export function routePathToPattern(apiPath: string): RegExp {
  // Substitute the dynamic segments BEFORE escaping. Escaping first leaves
  // `[id]` looking like a regex character class — it matches the letters i and
  // d, so `/api/lists/i` matched and `/api/lists/abc123` did not.
  const CATCH_ALL = '\u0000catchall\u0000'
  const SEGMENT = '\u0000segment\u0000'

  const source = apiPath
    .replace(/\[\.\.\.[^\]]+\]/g, CATCH_ALL)
    .replace(/\[[^\]]+\]/g, SEGMENT)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .split(CATCH_ALL)
    .join('.+')
    .split(SEGMENT)
    .join('[^/]+')

  return new RegExp(`^${source}$`)
}

/**
 * Attribute one URL literal to the route that actually serves it.
 *
 * Specificity matters and is not optional: `/api/lists/public` matches the
 * pattern for `/api/lists/[id]` just as well as it matches its own static
 * route, so a naive scan credits every static sibling to the dynamic route and
 * reports callers that do not exist. Longest-and-most-static wins, which is
 * also how the router resolves it.
 */
export function matchLiteralToRoute(literal: string, routePaths: string[]): string | null {
  const candidates = routePaths.filter((route) => routePathToPattern(route).test(literal))
  if (candidates.length === 0) return null

  const dynamicSegments = (route: string) => (route.match(/\[/g) || []).length
  return candidates.sort((a, b) => {
    const byDynamic = dynamicSegments(a) - dynamicSegments(b)
    if (byDynamic !== 0) return byDynamic
    return b.length - a.length
  })[0]
}

/** Ordered worst-first, so a report leads with what actually blocks the sunset. */
export const STATUS_ORDER: RouteStatus[] = [
  'needs-decision',
  'callers-remain',
  'unused-no-successor',
  'awaiting-traffic-evidence',
  'out-of-scope',
]

export function summarize(routes: RouteCoverage[]): Record<RouteStatus, number> {
  const counts = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<
    RouteStatus,
    number
  >
  for (const route of routes) counts[route.status] += 1
  return counts
}
