#!/usr/bin/env npx tsx
/**
 * Report the Core Web Vitals p75 for PERFORMANCE_BUDGETS.md (AWTD-904).
 *
 * The companion to scripts/measure-api-latency.ts: it produces the number the
 * budget row needs, so the CWV row has a measurement procedure a command can
 * run rather than one a person has to transcribe from a dashboard.
 *
 *   npx tsx scripts/measure-web-vitals.ts             # local database, 28d
 *   npx tsx scripts/measure-web-vitals.ts --prod      # production, read-only
 *   npx tsx scripts/measure-web-vitals.ts --days 7
 *
 * Reads only. It never writes, so it is safe to point at production.
 */

import { loadScriptEnv } from './lib/load-env'

loadScriptEnv()

const args = process.argv.slice(2)
const useProd = args.includes('--prod')
const daysArg = args.indexOf('--days')
const windowDays = daysArg >= 0 ? Number(args[daysArg + 1]) : 28

if (!Number.isFinite(windowDays) || windowDays <= 0) {
  console.error('--days must be a positive number')
  process.exit(1)
}

if (useProd) {
  const prod = process.env.DATABASE_URL_PROD
  if (!prod) {
    console.error('DATABASE_URL_PROD is not set; cannot run against production.')
    process.exit(1)
  }
  // Set before the Prisma client is imported, so the datasource is chosen
  // explicitly rather than inherited from whatever DATABASE_URL happens to be.
  process.env.DATABASE_URL = prod
}

async function main() {
  const { getWebVitalsReport } = await import('../lib/web-vitals-service')
  const { formatWebVital } = await import('../lib/web-vitals')

  const report = await getWebVitalsReport({ windowDays })

  console.log(`\nCore Web Vitals — ${useProd ? 'production' : 'local'}`)
  console.log(`  window        ${report.windowDays}d, since ${report.since.slice(0, 10)}`)
  console.log(`  total samples ${report.totalSamples}\n`)

  if (report.totalSamples === 0) {
    console.log('  No samples recorded in this window.')
    console.log('  That means NOT MEASURED, not "fast" — do not write a number')
    console.log('  into the budget table from this run.\n')
    console.log('  Vercel Speed Insights is still mounted and has history going')
    console.log('  back to 2025-08-13; it is dashboard-only, which is why this')
    console.log('  script exists.\n')
    return
  }

  for (const metric of report.metrics) {
    const verdict =
      metric.withinBudget === null ? '—' : metric.withinBudget ? 'within budget' : 'OVER BUDGET'
    console.log(
      `  ${metric.metric.padEnd(4)} p75 ${formatWebVital(metric.metric, metric.p75).padEnd(16)}` +
        ` threshold ${formatWebVital(metric.metric, metric.threshold).padEnd(12)}` +
        ` ${verdict}  (n=${metric.samples})`,
    )
    for (const state of ['anonymous', 'signed-in'] as const) {
      const bucket = metric.byAuthState[state]
      console.log(
        `       ${state.padEnd(10)} p75 ${formatWebVital(metric.metric, bucket.p75).padEnd(16)} (n=${bucket.samples})`,
      )
    }
  }

  console.log('\n  Top routes by sample count:')
  for (const route of report.routes.slice(0, 10)) {
    console.log(`    ${String(route.samples).padStart(6)}  ${route.route}`)
  }
  console.log()
}

main()
  .catch(err => {
    console.error(err)
    process.exit(1)
  })
