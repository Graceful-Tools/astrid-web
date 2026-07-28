#!/usr/bin/env tsx
/**
 * Deploy a brand profile as a Vercel preview.
 *
 * Task 97208a72. Brand variables come in two kinds and they need DIFFERENT flags:
 *
 *   NEXT_PUBLIC_*  are inlined into the bundle at build time  -> --build-env
 *   everything else (BRAND_ENABLED_AGENTS, BRAND_AGENT_EMAIL_DOMAIN) is read by server
 *                  code at request time                        -> --env (and --build-env,
 *                  so a build-time evaluation sees the same value)
 *
 * Passing a server-only variable as --build-env alone silently does nothing: the value
 * is present while Next compiles and absent when the route actually runs, so
 * BRAND.agentEmailDomain quietly falls back to NEXT_PUBLIC_BRAND_DOMAIN. Confirmed on a
 * deployed preview, which advertised agents at tasks.acme.example despite the pin.
 *
 * This reads `brands/<name>.brand.json` and routes each variable to the right flag.
 *
 *   npx tsx scripts/deploy-brand-preview.ts acme
 *   npx tsx scripts/deploy-brand-preview.ts astrid     # unbranded regression check
 *
 * BRAND_AGENT_EMAIL_DOMAIN is deliberately PINNED to the production value — see
 * brands/README.md. Previews share the production database and agent User rows are
 * created on demand, so a preview at a different agent domain would write junk
 * identities into production data.
 *
 * Pinned, not omitted: BRAND.agentEmailDomain falls back to NEXT_PUBLIC_BRAND_DOMAIN,
 * so merely leaving it out still moves agent identities to the brand's web domain. That
 * was the first attempt here and it did not work — verified against the deployed
 * preview, which resolved agents at tasks.acme.example.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadScriptEnv } from './lib/load-env'

loadScriptEnv()

/**
 * Forced to a fixed value on previews regardless of what the profile asks for, because
 * the profile's value would cause writes to the shared production database.
 */
const PINNED_FOR_PREVIEW: Record<string, string> = {
  // Keep agent identities exactly where production already has them.
  BRAND_AGENT_EMAIL_DOMAIN: 'astrid.cc',
}

const profileName = process.argv[2]
if (!profileName) {
  console.error('Usage: npx tsx scripts/deploy-brand-preview.ts <profile>')
  console.error('   e.g. npx tsx scripts/deploy-brand-preview.ts acme')
  process.exit(1)
}

const profilePath = join(process.cwd(), 'brands', `${profileName}.brand.json`)
if (!existsSync(profilePath)) {
  console.error(`❌ No such brand profile: brands/${profileName}.brand.json`)
  process.exit(1)
}

const token = process.env.VERCEL_TOKEN
if (!token) {
  console.error('❌ VERCEL_TOKEN not set (expected in .env.local)')
  process.exit(1)
}

const profile = JSON.parse(readFileSync(profilePath, 'utf8')) as {
  name: string
  description: string
  env: Record<string, string>
}

const applied: string[] = []
const pinned: string[] = []
const buildEnvArgs: string[] = []

/** NEXT_PUBLIC_* is inlined at build; anything else must also exist at runtime. */
function pushEnv(key: string, value: string) {
  buildEnvArgs.push('--build-env', `${key}=${value}`)
  if (!key.startsWith('NEXT_PUBLIC_')) {
    buildEnvArgs.push('--env', `${key}=${value}`)
  }
}

for (const [key, value] of Object.entries(profile.env)) {
  if (key in PINNED_FOR_PREVIEW) continue
  applied.push(key)
  pushEnv(key, value)
}

// Always send the pinned values, whether or not the profile mentioned them — the
// fallback chain means an absent variable is not the same as a safe one.
for (const [key, value] of Object.entries(PINNED_FOR_PREVIEW)) {
  pinned.push(`${key}=${value}`)
  pushEnv(key, value)
}

console.log(`\n🎨 Deploying brand profile: ${profile.name}`)
console.log(`   ${profile.description}\n`)
console.log(`   ${applied.length} build-env value(s) applied`)
if (pinned.length > 0) {
  console.log(`   pinned for previews: ${pinned.join(', ')}`)
  console.log('     (previews share the production database — see brands/README.md)')
}
console.log('')

const output = execFileSync(
  'npx',
  ['vercel', '--yes', '--token', token, '--scope', 'gracefultools', ...buildEnvArgs],
  { encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] }
)

const url = output.match(/https:\/\/[a-z0-9-]+\.vercel\.app/)?.[0]
console.log(output.trim())
if (url) {
  console.log(`\n✅ ${profile.name} preview: ${url}`)
  console.log(`   Verify:  curl -s ${url}/api/v1/capabilities | python3 -m json.tool`)
}
