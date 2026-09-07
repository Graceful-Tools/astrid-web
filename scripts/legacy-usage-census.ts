#!/usr/bin/env npx tsx
/**
 * The durable traffic census behind the legacy-API retirement decision.
 *
 * Usage:
 *   npx tsx scripts/legacy-usage-census.ts            # local database
 *   npx tsx scripts/legacy-usage-census.ts --prod     # production census
 *   npx tsx scripts/legacy-usage-census.ts --prod --safe-only
 *
 * WHY THIS EXISTS. Task dc9d67bb's method is "query the beacon for residual
 * traffic per path before removing anything" — but the only way to read that
 * census was an admin-session-gated GET on /api/internal/legacy-api-usage. So
 * the check the retirement is gated on could not be run from the place the
 * retirement is done, and whoever needed it wrote a throwaway script instead.
 * A throwaway is exactly how a wrong answer gets believed: it reimplements
 * `safeToDelete` in a hurry and skips the observation-window guard, which is
 * the only part that matters.
 *
 * This calls the SAME getLegacyUsageReport the admin endpoint serves, so there
 * is one implementation of the verdict rather than two.
 *
 * READ-ONLY. `--prod` repoints DATABASE_URL at the production database for the
 * life of the process, and the report issues nothing but selects. It is
 * deliberately a flag rather than a default: pointing a script at production
 * should be something you typed.
 *
 * Reading it: a route is `safeToDelete` ONLY when the window is genuinely empty
 * AND observation predates the window. "No traffic in 28 days" and "we have
 * only been counting for 8" are the same picture and opposite conclusions, and
 * lib/legacy-api-usage.ts refuses to confuse them. If everything says KEEP with
 * an "insufficient observation" reason, the answer is not to delete carefully —
 * it is to wait.
 */

import { loadScriptEnv } from './lib/load-env'

loadScriptEnv()

export {}

async function main() {
  const args = process.argv.slice(2)
  const useProd = args.includes('--prod')
  const safeOnly = args.includes('--safe-only')

  if (useProd) {
    const prodUrl = process.env.DATABASE_URL_PROD
    if (!prodUrl) {
      console.error('--prod needs DATABASE_URL_PROD in .env.local')
      process.exit(1)
    }
    // Assigned before the service is imported: lib/prisma binds its client at
    // module scope, so a later assignment would be read too late.
    process.env.DATABASE_URL = prodUrl
  }

  const { getLegacyUsageReport } = await import('../lib/legacy-api-usage-service')
  const { REQUIRED_OBSERVATION_DAYS } = await import('../lib/legacy-api-usage')

  const report = await getLegacyUsageReport()

  console.log(`\nLegacy API census — ${useProd ? 'production' : 'local'}`)
  console.log(
    `  window          ${REQUIRED_OBSERVATION_DAYS}d, opening ${report.windowStart.toISOString().slice(0, 10)}`
  )
  console.log(
    `  observing since ${report.observingSince?.toISOString().slice(0, 10) ?? 'never'} ` +
      `(${report.observedDays}d of durable telemetry)`
  )

  if (report.observedDays < REQUIRED_OBSERVATION_DAYS) {
    const earliest = new Date(
      (report.observingSince ?? new Date()).getTime() +
        REQUIRED_OBSERVATION_DAYS * 24 * 60 * 60 * 1000
    )
    console.log(
      `\n  ⚠️  NOTHING IS DELETABLE YET. The census needs ${REQUIRED_OBSERVATION_DAYS}d of\n` +
        `      observation before an empty window means "no traffic" rather than\n` +
        `      "not measured". Earliest any route can qualify: ${earliest.toISOString().slice(0, 10)}.`
    )
  }

  const rows = safeOnly ? report.routes.filter(r => r.safeToDelete) : report.routes
  const safe = report.routes.filter(r => r.safeToDelete).length

  console.log(`\n  ${report.routes.length} route(s) with recorded traffic — ${safe} safe to delete\n`)

  for (const route of rows) {
    console.log(`  ${route.safeToDelete ? 'SAFE' : 'KEEP'}  ${route.route}`)
    console.log(`        total=${route.total}  clients=${JSON.stringify(route.byClient)}`)
    console.log(`        ${route.reason}`)
  }

  // A route nobody has called does not appear above at all — there is no row to
  // summarise — so absence here is not evidence of anything. Pair this with
  // scripts/legacy-api-coverage.ts, which derives the full route list from the
  // filesystem and says whether a v1 successor exists.
  console.log(
    `\n  Routes with zero recorded hits do not appear here — no rows, nothing to\n` +
      `  summarise. Pair with: npx tsx scripts/legacy-api-coverage.ts --all\n`
  )
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
