/**
 * Print a brand profile's environment as JSON, for the Docker build (AWTD-1286).
 *
 *   npx tsx scripts/brand-env-file.ts acme              > brand-env.json
 *   npx tsx scripts/brand-env-file.ts ./my.brand.json   > brand-env.json
 *   npx tsx scripts/brand-env-file.ts                   # no profile: {} (Astrid's defaults)
 *
 * A profile goes through `profileEnv()`, the same function every test and deploy
 * applies it with (WHITELABELING §5), so the image ships what `check:brands`
 * checked. JSON rather than a dotenv or shell file, because brand copy is JSON
 * and survives no quoting scheme intact. deploy/self-host/load-env.mjs reads it,
 * at build (NEXT_PUBLIC_* are inlined then) and again at start (server-only
 * variables such as BRAND_ENABLED_AGENTS are read per request).
 */

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { profileEnv, type BrandProfile } from '../lib/brand/profile'

const arg = process.argv[2]?.trim()

if (!arg) {
  process.stdout.write('{}\n')
} else {
  const named = join(process.cwd(), 'brands', `${arg}.brand.json`)
  const path = existsSync(named) ? named : resolve(arg)
  if (!existsSync(path)) {
    console.error(`No brand profile at brands/${arg}.brand.json or ${path}`)
    process.exit(1)
  }
  const profile = JSON.parse(readFileSync(path, 'utf8')) as BrandProfile
  process.stdout.write(`${JSON.stringify(profileEnv(profile), null, 2)}\n`)
}
