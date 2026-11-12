/**
 * Initial-JS budget over Next's per-route bundle stats (AWTD-1593).
 *
 * `next build` (16.x, Turbopack) writes `.next/diagnostics/route-bundle-stats.json`:
 * one row per route with its first-load chunk paths and their UNCOMPRESSED total.
 * The budget in docs/PERFORMANCE_BUDGETS.md is compressed, so this gzips each chunk
 * (zlib default level, a chunk shared by many routes is read once) and sums per route.
 *
 * Two numbers, two jobs:
 * - TARGET_KIB is the budget the docs state. Routes over it are reported, not failed,
 *   while the shell is still over it everywhere.
 * - CEILING_KIB is a ratchet at the heaviest route's measured size. It fails the build
 *   when any route grows past it, and the check says when it can be lowered. Lower it
 *   whenever it can; never raise it to make a red check green.
 */

export const TARGET_KIB = 250

/**
 * KiB of slack over the measurement: CI builds with different public env values than a
 * laptop, which moves the inlined strings by a few hundred bytes.
 */
export const NOISE_KIB = 1

/**
 * Measured 2026-11-12 on the AWTD-1604 branch, after the [locale] layout's background
 * work moved behind next/dynamic: heaviest route `/[locale]/lists/[listId]` at 388.0 KiB
 * gzipped; every `/[locale]/settings/*` page that renders the TaskManager shell at
 * 387.2 KiB. The ceiling is that rounded up to a whole KiB, plus NOISE_KIB.
 * (405 → 389; AWTD-1593 set 405.)
 */
export const CEILING_KIB = 389

export interface RouteBundleStat {
  route: string
  firstLoadUncompressedJsBytes: number
  firstLoadChunkPaths: string[]
}

export interface RouteSize {
  route: string
  rawBytes: number
  gzipBytes: number
}

export interface BudgetVerdict {
  ok: boolean
  heaviest: RouteSize | undefined
  overCeiling: RouteSize[]
  overTarget: RouteSize[]
  /** Set when the ceiling could come down by a whole KiB or more. */
  lowerCeilingTo: number | undefined
}

export const kib = (bytes: number) => bytes / 1024

export function measureRoutes(
  stats: RouteBundleStat[],
  gzipSizeOf: (chunkPath: string) => number,
): RouteSize[] {
  const cache = new Map<string, number>()
  const sizeOf = (chunkPath: string) => {
    let size = cache.get(chunkPath)
    if (size === undefined) {
      size = gzipSizeOf(chunkPath)
      cache.set(chunkPath, size)
    }
    return size
  }
  return stats
    .map((row) => ({
      route: row.route,
      rawBytes: row.firstLoadUncompressedJsBytes,
      gzipBytes: [...new Set(row.firstLoadChunkPaths)].reduce((sum, p) => sum + sizeOf(p), 0),
    }))
    .sort((a, b) => b.gzipBytes - a.gzipBytes)
}

export function judge(
  sizes: RouteSize[],
  { ceilingKib = CEILING_KIB, targetKib = TARGET_KIB } = {},
): BudgetVerdict {
  const heaviest = sizes.reduce<RouteSize | undefined>(
    (max, s) => (!max || s.gzipBytes > max.gzipBytes ? s : max),
    undefined,
  )
  const overCeiling = sizes.filter((s) => kib(s.gzipBytes) > ceilingKib)
  const overTarget = sizes.filter((s) => kib(s.gzipBytes) > targetKib)
  const measuredCeiling = heaviest ? Math.ceil(kib(heaviest.gzipBytes)) + NOISE_KIB : 0
  return {
    ok: overCeiling.length === 0,
    heaviest,
    overCeiling,
    overTarget,
    lowerCeilingTo: heaviest && measuredCeiling < ceilingKib ? measuredCeiling : undefined,
  }
}
