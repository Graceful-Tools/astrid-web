/**
 * AWTD-1551 — the agent-integration benchmark never touches production, and its numbers mean
 * what the results doc says they mean.
 */

import { describe, expect, it } from 'vitest'
import { BRAND } from '@/lib/brand/config'
import {
  benchCredentials,
  benchmarkTargetProblem,
  resultsTable,
  rpcProblem,
  stdioScenarioProblem,
  summarize,
} from '@/scripts/lib/agent-benchmark'

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

describe('credentials: a preview needs no hand-made token (AWTD-1551)', () => {
  it('uses ASTRID_BENCH_TOKEN when given', () => {
    expect(benchCredentials({ ASTRID_BENCH_TOKEN: 't' }).token).toBe('t')
  })

  it('falls back to the script client pair, to exchange on the target', () => {
    const creds = benchCredentials({ ASTRID_OAUTH_CLIENT_ID: 'id', ASTRID_OAUTH_CLIENT_SECRET: 's' })
    expect(creds).toEqual({ token: null, clientId: 'id', clientSecret: 's', pairSource: 'ASTRID_OAUTH_CLIENT_*' })
  })

  it('prefers a BENCH pair over the script pair', () => {
    const creds = benchCredentials({
      ASTRID_BENCH_CLIENT_ID: 'b',
      ASTRID_BENCH_CLIENT_SECRET: 'bs',
      ASTRID_OAUTH_CLIENT_ID: 'id',
      ASTRID_OAUTH_CLIENT_SECRET: 's',
    })
    expect(creds.pairSource).toBe('ASTRID_BENCH_CLIENT_*')
    expect(creds.clientId).toBe('b')
  })

  it('reports nothing usable when nothing is set', () => {
    expect(benchCredentials({})).toEqual({ token: null, clientId: null, clientSecret: null, pairSource: null })
  })
})

describe('the stdio scenario cannot be redirected by the env file (AWTD-1551)', () => {
  const origin = 'https://bench.example.test'
  const pair = benchCredentials({ ASTRID_OAUTH_CLIENT_ID: 'id', ASTRID_OAUTH_CLIENT_SECRET: 's' })

  it('runs with the script pair and no base-URL override', () => {
    expect(stdioScenarioProblem({ ASTRID_OAUTH_CLIENT_ID: 'id' }, origin, pair)).toBeNull()
    expect(stdioScenarioProblem({ ASTRID_API_BASE_URL: `${origin}/` }, origin, pair)).toBeNull()
  })

  it('refuses when the launcher would talk to another origin', () => {
    expect(stdioScenarioProblem({ ASTRID_API_BASE_URL: `https://${D}` }, origin, pair)).toMatch(/ASTRID_API_BASE_URL/)
  })

  it('refuses when the launcher would swap a BENCH pair for the script pair', () => {
    const bench = benchCredentials({ ASTRID_BENCH_CLIENT_ID: 'b', ASTRID_BENCH_CLIENT_SECRET: 'bs' })
    expect(stdioScenarioProblem({ ASTRID_OAUTH_CLIENT_ID: 'id' }, origin, bench)).toMatch(/replace/)
  })

  it('skips without a pair', () => {
    expect(stdioScenarioProblem({}, origin, benchCredentials({ ASTRID_BENCH_TOKEN: 't' }))).toMatch(/no client-credentials pair/)
  })
})

describe('an MCP error is not timed as an answer (AWTD-1551)', () => {
  it('accepts a result, as JSON or as an event stream', () => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: '{}' }] } })
    expect(rpcProblem(body)).toBeNull()
    expect(rpcProblem(`event: message\ndata: ${body}\n\n`)).toBeNull()
  })

  it('rejects a tool error that arrives as HTTP 200', () => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { isError: true, content: [{ type: 'text', text: 'Task not found' }] } })
    expect(rpcProblem(body)).toMatch(/tool error: Task not found/)
  })

  it('rejects a JSON-RPC error and a body with no message', () => {
    expect(rpcProblem(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Method not found' } }))).toMatch(/Method not found/)
    expect(rpcProblem('')).toMatch(/no JSON-RPC/)
    expect(rpcProblem('{oops')).toMatch(/not JSON/)
  })
})
