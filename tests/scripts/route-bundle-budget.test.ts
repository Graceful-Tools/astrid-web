/**
 * AWTD-1593: the initial-JS gate over `.next/diagnostics/route-bundle-stats.json`.
 */
import { describe, it, expect } from 'vitest'
import {
  CEILING_KIB,
  NOISE_KIB,
  TARGET_KIB,
  judge,
  measureRoutes,
} from '../../scripts/lib/route-bundle-budget'

const KiB = 1024

describe('AWTD-1593: route bundle budget', () => {
  it('sums gzipped chunk sizes per route, reading a shared chunk once', () => {
    const reads: string[] = []
    const sizes = measureRoutes(
      [
        { route: '/a', firstLoadUncompressedJsBytes: 900, firstLoadChunkPaths: ['shared.js', 'a.js'] },
        { route: '/b', firstLoadUncompressedJsBytes: 700, firstLoadChunkPaths: ['shared.js', 'b.js', 'b.js'] },
      ],
      (chunk) => {
        reads.push(chunk)
        return { 'shared.js': 100, 'a.js': 50, 'b.js': 10 }[chunk]!
      },
    )
    expect(sizes).toEqual([
      { route: '/a', rawBytes: 900, gzipBytes: 150 },
      { route: '/b', rawBytes: 700, gzipBytes: 110 },
    ])
    expect(reads.filter((c) => c === 'shared.js')).toHaveLength(1)
  })

  it('fails only past the ceiling, and reports the routes over the target', () => {
    const route = (r: string, k: number) => ({ route: r, rawBytes: 0, gzipBytes: k * KiB })
    const green = judge([route('/settings', 300), route('/docs', 200)], { ceilingKib: 310, targetKib: 250 })
    expect(green.ok).toBe(true)
    expect(green.overTarget.map((s) => s.route)).toEqual(['/settings'])

    const red = judge([route('/settings', 311)], { ceilingKib: 310, targetKib: 250 })
    expect(red.ok).toBe(false)
    expect(red.overCeiling.map((s) => s.route)).toEqual(['/settings'])
  })

  it('says when the ratchet can come down, and not before', () => {
    const route = (k: number) => [{ route: '/x', rawBytes: 0, gzipBytes: k * KiB }]
    expect(judge(route(309.5), { ceilingKib: 310 + NOISE_KIB }).lowerCeilingTo).toBeUndefined()
    expect(judge(route(300.2), { ceilingKib: 310 }).lowerCeilingTo).toBe(301 + NOISE_KIB)
  })

  it('keeps the documented 250 KiB target, and a ceiling that has not been raised', () => {
    expect(TARGET_KIB).toBe(250)
    // Measured 2026-11-12. Lowering this is the point; raising it needs a reason in
    // docs/PERFORMANCE_BUDGETS.md and a change to this line in the same PR.
    expect(CEILING_KIB).toBeLessThanOrEqual(405)
  })
})
