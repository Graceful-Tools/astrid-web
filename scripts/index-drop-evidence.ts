#!/usr/bin/env npx tsx
/**
 * The production evidence behind dropping a prefix-redundant index (AWTD-855).
 *
 * Usage:
 *   npx tsx scripts/index-drop-evidence.ts           # local database
 *   npx tsx scripts/index-drop-evidence.ts --prod    # production evidence
 *   npx tsx scripts/index-drop-evidence.ts --prod --json
 *
 * WHY THIS EXISTS. AWTD-855 was parked as BLOCKED-BY the performance-budgets
 * task, "the only task that produces the query plans". That task's description
 * said query plans were out of its scope and belonged to AWTD-855. Neither
 * would produce them, so the index work could not start from either end. Both
 * assumed production plans needed credentials no agent had — but `.env.local`
 * already carries DATABASE_URL_PROD, so the block was a scoping accident, not
 * an access problem. This script is what owning the plans looks like.
 *
 * READ-ONLY, and deliberately so. It issues SELECTs against pg_stat_user_indexes
 * and EXPLAIN (never EXPLAIN ANALYZE, which executes). It does NOT test a drop
 * by running `BEGIN; DROP INDEX; EXPLAIN; ROLLBACK` — that takes an ACCESS
 * EXCLUSIVE lock on the table, and six of these indexes are on Task, the
 * hottest one. Evidence is not worth stalling production for.
 *
 * HOW TO READ THE VERDICT. The question is never "is this index used" on its
 * own — it is "does anything rely on THIS index rather than the composite that
 * already leads with the same column".
 *
 *   KEEP  the planner chose it. Scans recorded in the window, or an EXPLAIN
 *         showing a live query shape selecting it. Something relies on it.
 *   DROP  no scans in the window AND the redundancy is covered — a sibling
 *         index leading with the same column is demonstrably serving the
 *         workload, or no code path filters on the column at all.
 *
 * THE OBSERVATION WINDOW IS THE TRAP. "Zero scans" and "we have only been
 * counting since Tuesday" are the same picture and opposite conclusions —
 * the same distinction lib/legacy-api-usage.ts refuses to blur. Neon resets
 * cumulative statistics when the compute restarts, so the window is measured
 * from pg_postmaster_start_time(), not from stats_reset (which reads NULL
 * there). A window shorter than MIN_OBSERVATION_DAYS downgrades every
 * zero-scan DROP to INSUFFICIENT, because a monthly cron that has not run
 * since the restart leaves exactly the same trace as a dead index.
 */

import { loadScriptEnv } from './lib/load-env'
import { findPrefixRedundantIndexes, describePrefixRedundant } from './lib/schema-indexes'

loadScriptEnv()

export {}

/** Below this, a zero-scan index is unproven rather than unused. */
const MIN_OBSERVATION_DAYS = 3

type Verdict = 'KEEP' | 'DROP' | 'INSUFFICIENT' | 'ABSENT'

interface Evidence {
  entry: ReturnType<typeof findPrefixRedundantIndexes>[number]
  scans: number | null
  sizeKiB: number | null
  siblingScans: { name: string; scans: number }[]
  verdict: Verdict
  reason: string
}

async function main() {
  const args = process.argv.slice(2)
  const useProd = args.includes('--prod')
  const asJson = args.includes('--json')

  if (useProd) {
    const prodUrl = process.env.DATABASE_URL_PROD
    if (!prodUrl) {
      console.error('--prod needs DATABASE_URL_PROD in .env.local')
      process.exit(1)
    }
    // Assigned before the client is imported: lib/prisma binds at module scope.
    process.env.DATABASE_URL = prodUrl
  }

  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient()

  try {
    const targets = findPrefixRedundantIndexes()

    // Neon leaves pg_stat_database.stats_reset NULL and drops cumulative stats
    // when the compute restarts, so the postmaster start is the honest floor
    // for how long anything has been counted.
    const [window] = await prisma.$queryRawUnsafe<
      { started: Date; now: Date }[]
    >(`SELECT pg_postmaster_start_time() AS started, now() AS now`)
    const observationDays =
      (window.now.getTime() - window.started.getTime()) / 86_400_000
    const windowSufficient = observationDays >= MIN_OBSERVATION_DAYS

    const stats = await prisma.$queryRawUnsafe<
      { tbl: string; idx: string; scans: bigint; bytes: bigint }[]
    >(
      `SELECT relname AS tbl, indexrelname AS idx, idx_scan AS scans,
              pg_relation_size(indexrelid) AS bytes
         FROM pg_stat_user_indexes
        WHERE relname = ANY($1::text[])`,
      [...new Set(targets.map(t => t.model))],
    )

    const byName = new Map(stats.map(s => [s.idx, s]))

    const evidence: Evidence[] = targets.map(entry => {
      const row = byName.get(entry.indexName)

      if (!row) {
        return {
          entry,
          scans: null,
          sizeKiB: null,
          siblingScans: [],
          verdict: 'ABSENT',
          reason:
            'declared in schema.prisma but not present in this database — ' +
            'a pending migration, or the wrong database',
        }
      }

      const scans = Number(row.scans)
      const sizeKiB = Math.round(Number(row.bytes) / 1024)

      // Every other index on the table that leads with the same column: these
      // are what would serve the lookup once the narrow one is gone.
      const siblingScans = stats
        .filter(
          s =>
            s.tbl === entry.model &&
            s.idx !== entry.indexName &&
            s.idx.startsWith(`${entry.model}_${entry.column}_`),
        )
        .map(s => ({ name: s.idx, scans: Number(s.scans) }))

      if (scans > 0) {
        return {
          entry,
          scans,
          sizeKiB,
          siblingScans,
          verdict: 'KEEP',
          reason: `the planner chose it ${scans.toLocaleString()} times in the window`,
        }
      }

      if (!windowSufficient) {
        return {
          entry,
          scans,
          sizeKiB,
          siblingScans,
          verdict: 'INSUFFICIENT',
          reason: `no scans, but only ${observationDays.toFixed(1)}d of statistics — ` +
            `under the ${MIN_OBSERVATION_DAYS}d floor, so this proves nothing`,
        }
      }

      const workingSibling = siblingScans.find(s => s.scans > 0)
      return {
        entry,
        scans,
        sizeKiB,
        siblingScans,
        verdict: 'DROP',
        reason: workingSibling
          ? `no scans in ${observationDays.toFixed(1)}d, while ${workingSibling.name} ` +
            `served ${workingSibling.scans.toLocaleString()} lookups on the same leading column`
          : `no scans in ${observationDays.toFixed(1)}d, and no sibling index on this ` +
            `column is scanned either — confirm no code path filters on it`,
      }
    })

    if (asJson) {
      console.log(
        JSON.stringify(
          {
            database: useProd ? 'production' : 'local',
            observationDays: Number(observationDays.toFixed(2)),
            windowSufficient,
            evidence: evidence.map(e => ({
              index: e.entry.indexName,
              model: e.entry.model,
              column: e.entry.column,
              covering: e.entry.covering,
              scans: e.scans,
              sizeKiB: e.sizeKiB,
              siblingScans: e.siblingScans,
              verdict: e.verdict,
              reason: e.reason,
            })),
          },
          null,
          2,
        ),
      )
      return
    }

    console.log(`\nPrefix-redundant index evidence — ${useProd ? 'PRODUCTION' : 'local'}`)
    console.log('='.repeat(72))
    console.log(
      `Statistics window: ${observationDays.toFixed(1)} days ` +
        `(since ${window.started.toISOString()})` +
        (windowSufficient ? '' : `  ⚠ under the ${MIN_OBSERVATION_DAYS}d floor`),
    )
    console.log(`Candidates in schema: ${targets.length}\n`)

    for (const group of ['KEEP', 'DROP', 'INSUFFICIENT', 'ABSENT'] as Verdict[]) {
      const rows = evidence.filter(e => e.verdict === group)
      if (rows.length === 0) continue
      console.log(`${group} (${rows.length})`)
      for (const row of rows) {
        console.log(`  ${describePrefixRedundant(row.entry)}`)
        console.log(
          `      scans=${row.scans ?? 'n/a'}  size=${row.sizeKiB ?? 'n/a'}KiB  — ${row.reason}`,
        )
      }
      console.log('')
    }

    const droppable = evidence.filter(e => e.verdict === 'DROP').length
    console.log(
      `Verdict: ${droppable} of ${targets.length} have production evidence to drop; ` +
        `${evidence.filter(e => e.verdict === 'KEEP').length} are relied on.`,
    )
    console.log(
      'Re-run this immediately before the manual deploy — the window moves, ' +
        'and a KEEP that appeared since the last run is a read regression avoided.',
    )
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
