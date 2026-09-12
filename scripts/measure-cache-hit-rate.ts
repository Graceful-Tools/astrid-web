#!/usr/bin/env tsx
/**
 * Fleet Redis cache hit rate, from the production runtime logs.
 *
 * Task 2b89739c. The budget in docs/PERFORMANCE_BUDGETS.md promises >= 80%
 * after warm-up and had never been sampled, because the only evidence was the
 * per-lookup `Cache lookup` / `Cache load` events — emitted at `debug`, while
 * production runs at `info`, so every one of them was discarded before it
 * reached a log. Those events stay at debug on purpose (PR #260): they are
 * high-volume and promoting them trades a logging-cost regression for a
 * metric.
 *
 * `RedisCache` instead emits ONE `info` event per process per window,
 * `Cache metrics window`, carrying the window's DELTAS. This script sums them.
 *
 * Two things it is careful about, both of which produce a plausible-looking
 * wrong number if ignored:
 *
 *   1. THE FLEET RATE IS NOT THE MEAN OF THE PER-WINDOW RATES. A lambda that
 *      served three lookups and a lambda that served thirty thousand each
 *      contribute one `hitRate` field, and averaging them weights them
 *      equally. Sum hits and misses across every window, then divide once.
 *
 *   2. `vercel logs` RETURNS ~50 UNIQUE ROWS PER QUERY and pads beyond that,
 *      which is what made the server-error-rate row in the budget document
 *      unprovable. This script reports how many distinct instances and windows
 *      it actually saw, so a sample too thin to mean anything says so rather
 *      than printing a confident percentage over four rows.
 *
 * Read-only. Touches no database and no deployment.
 *
 * Usage:
 *   npx tsx scripts/measure-cache-hit-rate.ts [--hours 24] [--json]
 */

import { execFileSync } from 'node:child_process'
import { loadScriptEnv } from './lib/load-env'

loadScriptEnv()

interface WindowSample {
  instanceId: string
  windowMs: number
  hits: number
  misses: number
  loads: number
  coalesced: number
  errors: number
}

/** Minimum distinct windows before the number is worth writing down. */
const MIN_WINDOWS_FOR_A_CLAIM = 20

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

function readLogs(hours: number): string {
  const token = process.env.VERCEL_TOKEN
  const args = ['logs', 'https://astrid.cc', '--since', `${hours}h`, '--json', '--yes']
  if (token) args.push('--token', token)
  try {
    return execFileSync('vercel', args, { encoding: 'utf-8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024 })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/ENOENT/.test(message)) {
      console.error(
        'The `vercel` CLI is not on PATH. Install it (`npm i -g vercel`) or run this\n' +
        'from a shell that has it; this script reads production logs and has no\n' +
        'other source for them.',
      )
      process.exit(2)
    }
    console.error(`vercel logs failed: ${message}`)
    process.exit(2)
  }
}

/**
 * Pull the snapshots out of whatever the CLI emitted.
 *
 * The runtime-log JSON nests the application record under `message` as a
 * string, so the structured fields are found by scanning rather than by a
 * fixed path — the CLI's envelope has changed shape before.
 */
function parseSamples(raw: string): WindowSample[] {
  const samples: WindowSample[] = []
  const seen = new Set<string>()

  for (const line of raw.split('\n')) {
    if (!line.includes('Cache metrics window')) continue

    // The record may be the line itself, or embedded in an envelope's message.
    const candidates = [line]
    try {
      const envelope = JSON.parse(line)
      if (typeof envelope?.message === 'string') candidates.push(envelope.message)
    } catch { /* not an envelope; scan the raw line */ }

    for (const candidate of candidates) {
      const start = candidate.indexOf('{')
      if (start < 0) continue
      let record: Record<string, unknown> | null = null
      try {
        record = JSON.parse(candidate.slice(start))
      } catch { continue }
      if (!record || typeof record.hits !== 'number' || typeof record.misses !== 'number') continue

      // The CLI pads a short result set by repeating rows. A window is
      // identified by its instance and its start, so a repeat is dropped
      // rather than counted twice into the very number it would inflate.
      const fingerprint = `${record.instanceId}:${record.windowMs}:${record.hits}:${record.misses}:${(record as { time?: unknown }).time ?? ''}`
      if (seen.has(fingerprint)) continue
      seen.add(fingerprint)

      samples.push({
        instanceId: String(record.instanceId ?? 'unknown'),
        windowMs: Number(record.windowMs ?? 0),
        hits: record.hits,
        misses: record.misses,
        loads: Number(record.loads ?? 0),
        coalesced: Number(record.coalesced ?? 0),
        errors: Number(record.errors ?? 0),
      })
      break
    }
  }

  return samples
}

function main(): void {
  const hours = Number(arg('hours', '24'))
  const asJson = process.argv.includes('--json')

  const samples = parseSamples(readLogs(hours))

  const hits = samples.reduce((sum, s) => sum + s.hits, 0)
  const misses = samples.reduce((sum, s) => sum + s.misses, 0)
  const lookups = hits + misses
  const instances = new Set(samples.map(s => s.instanceId)).size
  // Divide once, at the end — see note 1 in the header.
  const hitRate = lookups > 0 ? (hits / lookups) * 100 : null
  const sufficient = samples.length >= MIN_WINDOWS_FOR_A_CLAIM

  if (asJson) {
    console.log(JSON.stringify({
      version: 1, hours, windows: samples.length, instances,
      hits, misses, lookups, hitRate, sufficient,
      coalesced: samples.reduce((s, x) => s + x.coalesced, 0),
      errors: samples.reduce((s, x) => s + x.errors, 0),
    }, null, 2))
    return
  }

  console.log(`\nRedis cache hit rate — last ${hours}h of production logs\n`)
  console.log(`  windows observed   ${samples.length}`)
  console.log(`  distinct instances ${instances}`)
  console.log(`  hits / misses      ${hits} / ${misses}`)
  console.log(`  lookups            ${lookups}`)
  console.log(`  coalesced loads    ${samples.reduce((s, x) => s + x.coalesced, 0)}`)
  console.log(`  cache errors       ${samples.reduce((s, x) => s + x.errors, 0)}`)

  if (hitRate === null) {
    console.log('\n  No cache-metrics windows found.')
    console.log('  Either the deployment predates this event, or the instances serving')
    console.log('  traffic in this period never completed a window. Check that a deploy')
    console.log('  carrying `Cache metrics window` has actually shipped.\n')
    process.exit(1)
  }

  console.log(`\n  HIT RATE           ${hitRate.toFixed(2)}%  (budget: >= 80%)`)

  if (!sufficient) {
    console.log(`\n  SAMPLE TOO THIN to write into the budget document.`)
    console.log(`  ${samples.length} windows, and ${MIN_WINDOWS_FOR_A_CLAIM} is the floor. \`vercel logs\` returns`)
    console.log('  roughly 50 unique rows per query and pads past that, which is exactly')
    console.log('  how the server-error-rate row ended up unprovable. Widen --hours, or')
    console.log('  take several windows and add them up.\n')
    process.exit(1)
  }

  console.log(`  ${hitRate >= 80 ? 'WITHIN BUDGET' : 'OVER BUDGET'}\n`)
}

main()
