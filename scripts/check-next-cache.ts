#!/usr/bin/env tsx
/**
 * `predev` guard: repair a corrupt `.next` before `next dev` chokes on it.
 *
 * Without this, one torn manifest 500s every route with a bare `SyntaxError`
 * naming no file, while the production build stays green — a combination that
 * cost a whole UI verification pass on AWTD-934. Recovery is `rm -rf .next`,
 * which only helps someone who already knows the cause, so it runs on its own.
 *
 * Always exits 0. A cache that has to be rebuilt is a slower `npm run dev`, not
 * a reason to refuse to start one.
 */
import { repairNextCache, findCorruptManifests } from './lib/next-cache-integrity'

const dryRun = process.argv.includes('--dry-run')
const { corrupt, cleared } = repairNextCache(process.cwd(), { dryRun })

if (corrupt.length === 0) {
  if (process.argv.includes('--verbose')) console.log('✅ .next cache parses cleanly')
  process.exit(0)
}

console.warn(`⚠️  ${corrupt.length} unparseable file(s) in .next — this 500s every dev route:`)
for (const entry of corrupt.slice(0, 5)) {
  console.warn(`   ${entry.file}`)
  console.warn(`     ${entry.reason}`)
}
if (corrupt.length > 5) console.warn(`   …and ${corrupt.length - 5} more`)

console.warn(
  dryRun
    ? `   Would remove: ${cleared.join(', ')} (--dry-run)`
    : `🧹 Removed ${cleared.join(', ')} — Next will rebuild it on this run.`,
)
