#!/usr/bin/env npx tsx
/**
 * Sample real latency and response size for the critical read routes, so the
 * performance budget is checked against a number rather than an intention.
 *
 * Usage:
 *   npx tsx scripts/measure-api-latency.ts                 # production, 30 warm
 *   npx tsx scripts/measure-api-latency.ts --samples 50
 *   npx tsx scripts/measure-api-latency.ts --json
 *   npx tsx scripts/measure-api-latency.ts --breakdown    # what carries the bytes
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

/**
/**
 * Which KEYS carry the bytes (AWTD-1231).
 *
 * When the task response went over budget, the natural first guess was "a field
 * was added" — and it was wrong by two orders of magnitude: every schema
 * addition since the previous measurement came to under 2 KiB, while
 * `description` alone was 443 KiB of 552. Guessing costs a wasted afternoon;
 * this costs one request.
 *
 * MARGINAL cost, not share of the decoded bytes: each key is dropped from every
 * task and the whole response re-gzipped, so what is reported is what removing
 * it would actually save on the wire. Those two numbers differ a lot for a key
 * that repeats — `id` is 36 unique characters a thousand times over and
 * compresses badly; a repeated enum compresses to almost nothing.
 */
async function measureKeyBreakdown(token: string, top = 15): Promise<void> {
  const route = ROUTES[0]
  const res = await fetch(`${BASE}${route.path}`, { headers: { 'X-OAuth-Token': token } })
  if (!res.ok) {
    console.log(`Key breakdown skipped: ${route.label} answered ${res.status}\n`)
    return
  }
  const body = (await res.json()) as { tasks?: Record<string, unknown>[] }
  const tasks = body.tasks ?? []
  if (tasks.length === 0) {
    console.log('Key breakdown skipped: no tasks returned\n')
    return
  }

  const full = gzipSync(Buffer.from(JSON.stringify(body))).length
  const keys = [...new Set(tasks.flatMap(task => Object.keys(task)))]
  const rows = keys.map(key => {
    const stripped = tasks.map(task => {
      const copy = { ...task }
      delete copy[key]
      return copy
    })
    const size = gzipSync(Buffer.from(JSON.stringify({ ...body, tasks: stripped }))).length
    return { key, kib: (full - size) / 1024 }
  })
  rows.sort((a, b) => b.kib - a.kib)

  console.log(`Marginal wire cost per key — ${route.label}, ${tasks.length} tasks`)
  console.log(`   total ${(full / 1024).toFixed(1)} KiB\n`)
  for (const row of rows.slice(0, top)) {
    console.log(`   ${row.kib.toFixed(1).padStart(7)} KiB  ${row.key}`)
  }
  const rest = rows.slice(top).reduce((sum, row) => sum + row.kib, 0)
  console.log(`   ${rest.toFixed(1).padStart(7)} KiB  — the remaining ${Math.max(rows.length - top, 0)} keys\n`)
}

/**
 * The GitHub project-fields payload gate (AWTD-1208, spec §9.4.3).
 *
 * `fields` puts one entry per (task, project field) on every task in a list
 * response. The spec's budget decides whether that can ride on the list route
 * at all, so it has to be a measurement rather than an intention — the same
 * argument this whole script exists for.
 *
 * WHY SYNTHETIC, AND WHY THAT IS STILL HONEST. There is no GitHub-backed board
 * in production with a thousand tasks, and this script is a read-only client of
 * astrid.cc — it seeds nothing. So the fixture is applied to the REAL thousand-
 * task response: the measured payload, with a realistic `fields` block grafted
 * onto each task, re-compressed. That is exactly the marginal wire cost the
 * budget is about, measured against the real payload's own compressibility
 * rather than against an invented one.
 *
 * WHY COMPRESSION DECIDES IT. Uncompressed, 8 entries per task is ~450 bytes a
 * task — ~440 KB over a thousand, which would blow a 500 KiB budget on its own.
 * But only 8 distinct field ids repeat across every task, and a single-select
 * has a handful of option ids, so most of those bytes are repetition that gzip
 * removes. The free-text fields are what does not compress, which is why the
 * fixture includes two of them with per-task content.
 */
const FIELDS_PER_TASK = 8
const FIXTURE_TASKS = 1000

/** Eight fields of the shape §9.4.1 describes, with ids the size Postgres mints. */
function fieldsFixture(taskIndex: number): Record<string, string | number> {
  const fieldId = (n: number) => `f47ac10b-58cc-4372-a567-0e02b2c3d4${String(n).padStart(2, '0')}`
  // Single-select and iteration values come from small sets, as GitHub's do.
  const option = ['f75ad846', '47fc9ee4', 'df73e18b', '98236657', 'bc3f2a91'][taskIndex % 5]
  const status = ['a1b2c3d4', 'e5f6a7b8', '09c8d7e6'][taskIndex % 3]
  const iteration = ['PVTI_lADOA1', 'PVTI_lADOA2', 'PVTI_lADOA3', 'PVTI_lADOA4'][taskIndex % 4]
  const day = String((taskIndex % 28) + 1).padStart(2, '0')
  return {
    [fieldId(1)]: option,
    [fieldId(2)]: status,
    [fieldId(3)]: iteration,
    [fieldId(4)]: `2026-${String((taskIndex % 12) + 1).padStart(2, '0')}-${day}`,
    [fieldId(5)]: `2026-11-${day}`,
    [fieldId(6)]: (taskIndex % 13) + 0.5,
    // The two that do not compress away: per-task free text.
    [fieldId(7)]: `Rollout note ${taskIndex} for the ${['infra', 'billing', 'search', 'mobile'][taskIndex % 4]} track`,
    [fieldId(8)]: `owner-${taskIndex % 37}@example.com queued ${taskIndex}`,
  }
}

interface GateResult {
  baselineWireKiB: number
  withFieldsWireKiB: number
  marginalKiB: number
  budgetKiB: number
  headroomKiB: number
  tasksMeasured: number
  fits: boolean
}

async function measureFieldsGate(token: string): Promise<GateResult | null> {
  const route = ROUTES[0]
  const res = await fetch(`${BASE}${route.path}`, { headers: { 'X-OAuth-Token': token } })
  if (!res.ok) return null
  const body = (await res.json()) as { tasks?: unknown[] }
  const tasks = body.tasks ?? []
  if (tasks.length === 0) return null

  // Grow the sample to the fixture's thousand by repeating what production has,
  // so the measurement is of a thousand-task board rather than of whatever the
  // test account happens to hold today.
  const grown = Array.from({ length: FIXTURE_TASKS }, (_, i) => tasks[i % tasks.length])
  const withFields = {
    ...body,
    tasks: grown.map((task, i) => ({ ...(task as object), fields: fieldsFixture(i) })),
  }
  const baselineGrown = gzipSync(
    Buffer.from(JSON.stringify({ ...body, tasks: grown })),
  ).length
  const augmented = gzipSync(Buffer.from(JSON.stringify(withFields))).length

  const kib = (bytes: number) => Math.round((bytes / 1024) * 10) / 10
  return {
    baselineWireKiB: kib(baselineGrown),
    withFieldsWireKiB: kib(augmented),
    marginalKiB: kib(augmented - baselineGrown),
    budgetKiB: route.budgetKiB,
    headroomKiB: kib(route.budgetKiB * 1024 - baselineGrown),
    tasksMeasured: tasks.length,
    fits: augmented <= route.budgetKiB * 1024,
  }
}

async function main() {
  const args = process.argv.slice(2)
  const asJson = args.includes('--json')
  const samplesArg = args.indexOf('--samples')
  const samples = samplesArg >= 0 ? Number(args[samplesArg + 1]) : 30
  // --breakdown answers "what is actually in there", which is a different
  // question from "is it too big" and only worth a request when asked.
  const wantsBreakdown = args.includes('--breakdown')

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

  if (wantsBreakdown) await measureKeyBreakdown(token)

  // AWTD-1208: does `fields` fit on the list route, or must it go behind
  // ?include=fields? Printed with the routes because it is the same budget.
  const gate = await measureFieldsGate(token)
  if (gate) {
    console.log(`GitHub project fields on 1,000 tasks x ${FIELDS_PER_TASK} fields (AWTD-1208)`)
    console.log(
      `   baseline ${gate.baselineWireKiB} KiB  →  with fields ${gate.withFieldsWireKiB} KiB  ` +
        `(+${gate.marginalKiB} KiB)`,
    )
    console.log(
      `   budget ${gate.budgetKiB} KiB: ${gate.fits ? 'FITS — values may ride list responses' : 'OVER BUDGET — values go behind ?include=fields'}`,
    )
    console.log(`   (grown from the ${gate.tasksMeasured} tasks production returned)\n`)
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
