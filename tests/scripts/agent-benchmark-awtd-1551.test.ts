/**
 * AWTD-1551 — the agent-integration benchmark never touches production, and its numbers mean
 * what the results doc says they mean.
 */

import { describe, expect, it } from 'vitest'
import { BRAND } from '@/lib/brand/config'
import { benchmarkTargetProblem, resultsTable, summarize } from '@/scripts/lib/agent-benchmark'

const D = BRAND.domain

describe('the benchmark refuses production (AWTD-1551)', () => {
  it.each([`https://${D}`, `https://www.${D}`, `https://WWW.${D.toUpperCase()}/api`, `https://api.${D}`])(
    'refuses %s (this deployment\'s production domain)',
    (origin) => {
      expect(benchmarkTargetProblem(origin)).toMatch(/production/)
    },
  )

  it.each(['https://astrid-web-preview-abc123-gracefultools.vercel.app', 'http://localhost:3000'])(
    'allows %s',
    (origin) => {
      expect(benchmarkTargetProblem(origin)).toBeNull()
    },
  )

  it('refuses something that is not a URL', () => {
    expect(benchmarkTargetProblem('')).toMatch(/not a URL/)
    expect(benchmarkTargetProblem('ftp://example.test')).toMatch(/protocol/)
  })
})

describe('the statistics (AWTD-1551)', () => {
  it('reports p50, p95, mean, sample deviation, median bytes and a token estimate', () => {
    const samples = Array.from({ length: 20 }, (_, i) => ({ ms: i + 1, bytes: 400 + i }))
    const s = summarize(samples)
    expect(s.n).toBe(20)
    expect(s.p50).toBe(10)
    expect(s.p95).toBe(19)
    expect(s.mean).toBe(10.5)
    expect(s.stdev).toBeCloseTo(5.9, 1)
    expect(s.medianBytes).toBe(409)
    expect(s.approxTokens).toBe(103)
  })

  it('does not divide by zero on one sample or none', () => {
    expect(summarize([{ ms: 5, bytes: 8 }])).toMatchObject({ p50: 5, p95: 5, stdev: 0 })
    expect(summarize([])).toMatchObject({ n: 0, p50: 0, mean: 0 })
  })

  it('renders one Markdown row per call', () => {
    const table = resultsTable([{ scenario: 'REST', call: 'GET /api/v1/agent-queue', summary: summarize([{ ms: 3, bytes: 4 }]) }])
    expect(table.split('\n')).toHaveLength(3)
    expect(table).toContain('| REST | GET /api/v1/agent-queue | 1 |')
  })
})
