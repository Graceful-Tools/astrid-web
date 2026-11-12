/**
 * Fail when any route's first-load JS (gzipped) grows past the ratchet ceiling (AWTD-1593).
 *
 *   npx next build && npm run check:bundle
 *
 * Reads `.next/diagnostics/route-bundle-stats.json`, which `next build` writes. Logic and
 * the budget numbers live in scripts/lib/route-bundle-budget.ts; the measurement history
 * is in docs/PERFORMANCE_BUDGETS.md ("Initial JavaScript").
 */

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { gzipSync } from 'zlib'
import {
  CEILING_KIB,
  TARGET_KIB,
  judge,
  kib,
  measureRoutes,
  type RouteBundleStat,
} from './lib/route-bundle-budget'

const root = process.cwd()
const statsPath = join(root, '.next/diagnostics/route-bundle-stats.json')

if (!existsSync(statsPath)) {
  console.error(`❌ ${statsPath} is missing. Run \`next build\` first.`)
  process.exit(1)
}

const stats = JSON.parse(readFileSync(statsPath, 'utf8')) as RouteBundleStat[]
const sizes = measureRoutes(stats, (chunk) => gzipSync(readFileSync(join(root, chunk))).length)
const verdict = judge(sizes)
const fmt = (bytes: number) => `${kib(bytes).toFixed(1)} KiB`

console.log(`Initial JS, gzipped first load, ${sizes.length} routes (ceiling ${CEILING_KIB} KiB, target ${TARGET_KIB} KiB)`)
for (const s of sizes.slice(0, 5)) console.log(`  ${fmt(s.gzipBytes).padStart(10)}  ${s.route}`)
console.log(`  ${verdict.overTarget.length} of ${sizes.length} routes are over the ${TARGET_KIB} KiB target.`)

if (!verdict.ok) {
  console.error(`\n❌ ${verdict.overCeiling.length} route(s) grew past the ${CEILING_KIB} KiB ceiling:`)
  for (const s of verdict.overCeiling) console.error(`  ${fmt(s.gzipBytes).padStart(10)}  ${s.route}`)
  console.error(
    '\nThe ceiling is a ratchet: it only goes down. Find what the change added to the first load ' +
      '(a static import that could be next/dynamic, a library pulled into a client component) ' +
      'rather than raising CEILING_KIB in scripts/lib/route-bundle-budget.ts.',
  )
  process.exit(1)
}

if (verdict.lowerCeilingTo !== undefined) {
  console.log(
    `\n⬇️  The heaviest route is now ${fmt(verdict.heaviest!.gzipBytes)}: lower CEILING_KIB to ` +
      `${verdict.lowerCeilingTo} in scripts/lib/route-bundle-budget.ts and record it in docs/PERFORMANCE_BUDGETS.md.`,
  )
}
console.log(`\n✅ Every route is within the ${CEILING_KIB} KiB ceiling.`)
