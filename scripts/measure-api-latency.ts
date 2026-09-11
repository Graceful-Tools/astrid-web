#!/usr/bin/env npx tsx
/**
 * Sample real latency and response size for the critical read routes, so the
 * performance budget is checked against a number rather than an intention.
 *
 * Usage:
 *   npx tsx scripts/measure-api-latency.ts                 # production, 30 warm
 *   npx tsx scripts/measure-api-latency.ts --samples 50
 *   npx tsx scripts/measure-api-latency.ts --json
 *
 * WHY THIS EXISTS. docs/PERFORMANCE_BUDGETS.md has carried a latency budget
 * (p50 <= 250 ms, p95 <= 750 ms) since 2026-08-31 with no recorded measurement
 * against it, across three passes by three agents. Each pass reported the same
 * blocker — no production-shaped environment — and the budget stayed a
 * promise. A budget nothing is ever measured against is decoration.
 *
 * WHY NOT `vercel logs`. Because it cannot answer this, and a previous review
 * of this task (2026-09-10) wrongly said it could. The runtime-log JSON the
 * CLI emits carries exactly these fields — id, timestamp, deploymentId,
 * projectId, level, message, source, domain, requestMethod, requestPath,
 * responseStatusCode, environment, branch, cache, traceId — and no duration of
 * any kind. Per-request timing is not in there to be filtered out. (Structured
 * app logs do carry durationMs, but only where the code logs it itself, which
 * today is the cron jobs and not the request path.)
 *
 * WHAT THIS MEASURES, STATED PRECISELY. Wall-clock time for an HTTPS request
 * from THIS machine to astrid.cc, including DNS, TLS, client-to-edge network
 * and the edge-to-function hop. That is strictly MORE than server latency, so
 * it is an upper bound: a p95 inside budget proves the server is inside
 * budget, while a p95 over budget needs a second look before it is called a
 * server regression. It is deliberately not a synthetic in-process benchmark —
 * those measure a machine nobody uses.
 *
 * COMPRESSED OR NOT IS NOT A DETAIL — it flips the verdict. On 2026-09-11 the
 * full task list was 2,302 KiB decoded and 437 KiB gzipped. Against the same
 * 500 KiB budget that is 4.6x over, or comfortably inside, depending entirely
 * on a convention the budget document did not state. This script judges the
 * WIRE size, because that is what the document's own curl recipe measures
 * (`%{size_download}` is post-compression) and what a client actually waits
 * for. The decoded size is reported alongside it, because that is what parses
 * and retains in memory on a phone.
 *
 * READ-ONLY: issues GETs against the public v1 API with an OAuth token. It
 * does not touch the database, and it creates nothing.
 */

import { gzipSync } from 'node:zlib'
import { loadScriptEnv } from './lib/load-env'

loadScriptEnv()

export {}

const BASE = process.env.ASTRID_API_BASE ?? 'https://astrid.cc'

/** The routes docs/PERFORMANCE_BUDGETS.md names as critical reads. */
const ROUTES: { label: string; path: string; budgetKiB: number }[] = [
  { label: 'GET /api/v1/tasks (full)', path: '/api/v1/tasks?limit=1000&leanListMembers=1', budgetKiB: 500 },
  { label: 'GET /api/v1/lists', path: '/api/v1/lists', budgetKiB: 250 },
]

/** Budgets from docs/PERFORMANCE_BUDGETS.md, so drift shows up as a failure. */
const P50_BUDGET_MS = 250
const P95_BUDGET_MS = 750

/** Discarded before measuring: they pay for connection setup and a cold cache. */
const WARMUP_REQUESTS = 3

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN
  // Nearest-rank, which needs no interpolation story to defend.
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.min(rank, sorted.length) - 1]
}

async function getToken(): Promise<string> {
  const client_id = process.env.ASTRID_OAUTH_CLIENT_ID
  const client_secret = process.env.ASTRID_OAUTH_CLIENT_SECRET
  if (!client_id || !client_secret) {
    console.error('Needs ASTRID_OAUTH_CLIENT_ID and ASTRID_OAUTH_CLIENT_SECRET in .env.local')
    process.exit(1)
  }

  const res = await fetch(`${BASE}/api/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id, client_secret }),
  })
  if (!res.ok) {
    console.error(`Token request failed: ${res.status} ${await res.text()}`)
    process.exit(1)
  }
  return (await res.json()).access_token
}

interface RouteResult {
  label: string
  path: string
  samples: number
  p50: number
  p95: number
  min: number
  max: number
  /** Decoded JSON bytes — what the client parses. */
  decodedKiB: number
  /** Compressed bytes — what crosses the wire, and what the budget is against. */
  wireKiB: number
  budgetKiB: number
  errors: number
  withinLatency: boolean
  withinSize: boolean
}

async function measureRoute(
  route: (typeof ROUTES)[number],
  token: string,
  samples: number,
): Promise<RouteResult> {
  const timings: number[] = []
  let bytes = 0
  let wireBytes = 0
  let errors = 0

  for (let i = 0; i < samples + WARMUP_REQUESTS; i++) {
    const started = performance.now()
    let ok = false
    try {
      const res = await fetch(`${BASE}${route.path}`, { headers: { 'X-OAuth-Token': token } })
      // Drain the body before stopping the clock: a response is not served
      // until it is read, and measuring only the headers would flatter every
      // large payload — which is exactly what the size budget is about.
      const body = await res.arrayBuffer()
      ok = res.ok
      if (i >= WARMUP_REQUESTS) {
        bytes = body.byteLength
        // undici transparently decompresses, and these responses are chunked
        // with no content-length, so the wire size is not readable from the
        // response. Re-compressing locally reproduces it closely: measured
        // 2026-09-11 against `curl --compressed` on the same payload, zlib
        // level 6 gave 450,025 bytes against 447,342 observed — 0.6% high.
        wireBytes = gzipSync(Buffer.from(body)).length
      }
    } catch {
      ok = false
    }
    const elapsed = performance.now() - started

    if (i < WARMUP_REQUESTS) continue
    if (!ok) errors++
    else timings.push(elapsed)
  }

  const sorted = [...timings].sort((a, b) => a - b)
  const p50 = percentile(sorted, 50)
  const p95 = percentile(sorted, 95)
  const decodedKiB = Math.round((bytes / 1024) * 10) / 10
  const wireKiB = Math.round((wireBytes / 1024) * 10) / 10

  return {
    label: route.label,
    path: route.path,
    samples: timings.length,
    p50: Math.round(p50),
    p95: Math.round(p95),
    min: Math.round(sorted[0] ?? NaN),
    max: Math.round(sorted[sorted.length - 1] ?? NaN),
    decodedKiB,
    wireKiB,
    budgetKiB: route.budgetKiB,
    errors,
    withinLatency: p50 <= P50_BUDGET_MS && p95 <= P95_BUDGET_MS,
    withinSize: wireKiB <= route.budgetKiB,
  }
}

async function main() {
  const args = process.argv.slice(2)
  const asJson = args.includes('--json')
  const samplesArg = args.indexOf('--samples')
  const samples = samplesArg >= 0 ? Number(args[samplesArg + 1]) : 30

  const token = await getToken()
  const results: RouteResult[] = []
  for (const route of ROUTES) {
    results.push(await measureRoute(route, token, samples))
  }

  if (asJson) {
    console.log(
      JSON.stringify(
        { base: BASE, measuredAt: new Date().toISOString(), samples, results },
        null,
        2,
      ),
    )
    return
  }

  console.log(`\nCritical read latency — ${BASE}`)
  console.log('='.repeat(72))
  console.log(`${samples} warm samples per route (${WARMUP_REQUESTS} discarded), ${new Date().toISOString()}`)
  console.log('Wall clock from this machine: includes network, so an upper bound on server time.\n')

  for (const r of results) {
    const latency = r.withinLatency ? 'within budget' : 'OVER BUDGET'
    const size = r.withinSize ? 'within budget' : 'OVER BUDGET'
    console.log(r.label)
    console.log(
      `   p50 ${r.p50}ms  p95 ${r.p95}ms  (min ${r.min} / max ${r.max})  ` +
        `— budget p50 ${P50_BUDGET_MS} / p95 ${P95_BUDGET_MS}: ${latency}`,
    )
    console.log(
      `   ${r.wireKiB} KiB on the wire of ${r.budgetKiB} KiB: ${size}  ` +
        `(${r.decodedKiB} KiB decoded)`,
    )
    if (r.errors > 0) console.log(`   ⚠ ${r.errors} failed request(s) of ${samples}`)
    console.log('')
  }

  const breached = results.filter(r => !r.withinLatency || !r.withinSize)
  if (breached.length > 0) {
    console.log(`${breached.length} route(s) over budget. Investigate before raising the budget.`)
    process.exitCode = 1
  } else {
    console.log('All measured routes within budget.')
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
