#!/usr/bin/env tsx
/**
 * Rebuild AnalyticsDailyStats for a date range from the surviving AnalyticsEvent rows.
 *
 * aggregateDailyStats threw for months, so no daily-stats row was written at all
 * (task 8f719931). The raw events were never affected, so the gap is repaired by
 * re-running the aggregation per day — an upsert on a @unique date column, safe
 * to repeat (task 82752f76).
 *
 * This is NOT scripts/backfill-analytics.ts, which fabricates AnalyticsEvent rows
 * and rewrites every day in the table. Prefer this one.
 *
 * Usage:
 *   npx tsx scripts/reaggregate-analytics.ts --from 2026-08-16 --to 2026-09-05 --dry-run
 *   npx tsx scripts/reaggregate-analytics.ts --from 2026-08-16 --to 2026-09-05
 */
import { loadScriptEnv } from './lib/load-env'
import { parseDayWindow } from './lib/analytics-reaggregation'

loadScriptEnv()

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

/** Host only — never print the credentials in a connection string. */
function databaseHost(): string {
  const url = process.env.DATABASE_URL
  if (!url) return '(DATABASE_URL unset)'
  try {
    const parsed = new URL(url)
    return `${parsed.hostname}${parsed.pathname}`
  } catch {
    return '(unparseable DATABASE_URL)'
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const days = parseDayWindow({ from: flag('from'), to: flag('to') })

  const first = days[0].toISOString().split('T')[0]
  const last = days[days.length - 1].toISOString().split('T')[0]

  // Which database is a decision, not a detail: the same command repairs
  // production or quietly rebuilds a dev box depending on this one value.
  console.log(`Database: ${databaseHost()}`)
  console.log(`Window:   ${first} → ${last} (${days.length} day${days.length === 1 ? '' : 's'})`)

  if (dryRun) {
    console.log('\n--dry-run: no rows written. Days that would be rebuilt:')
    for (const day of days) console.log(`  ${day.toISOString().split('T')[0]}`)
    return
  }

  const { aggregateDailyStats } = await import('../lib/analytics-events')

  let rebuilt = 0
  for (const day of days) {
    await aggregateDailyStats(day)
    rebuilt++
    process.stdout.write(`\r  Rebuilt ${rebuilt}/${days.length} days`)
  }
  console.log(`\n✅ Rebuilt ${rebuilt} day(s) of AnalyticsDailyStats.`)
}

main()
  .catch((error) => {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  })
  .then(async () => {
    const { prisma } = await import('../lib/prisma')
    await prisma.$disconnect()
  })
