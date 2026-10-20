#!/usr/bin/env tsx
/**
 * Deploy a brand profile as a Vercel preview.
 *
 * Task 97208a72. Brand variables come in two kinds and they need DIFFERENT flags:
 *
 *   NEXT_PUBLIC_*  are inlined into the bundle at build time  -> --build-env
 *   everything else (BRAND_ENABLED_AGENTS, BRAND_ASSISTANT_SERVICE, BRAND_AGENT_EMAIL_DOMAIN) is read by server
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
 *   npx tsx scripts/deploy-brand-preview.ts whitelabel --alias whitelabel.astrid.cc
 *
 * `--alias <hostname>` points a stable hostname at the deployment afterwards, the
 * way scripts/deploy-preview.sh aliases <branch>.astrid.cc — the wildcard domain on
 * the Vercel project makes any subdomain work. Without it the preview is reachable
 * only at its one-off *.vercel.app URL, which is fine for a check and useless for a
 * test site people keep coming back to.
 *
 * BRAND_AGENT_EMAIL_DOMAIN is deliberately PINNED to the production value — see
 * brands/README.md. Previews share the production database and agent User rows are
 * created on demand, so a preview at a different agent domain would write junk
 * identities into production data.
 *
 * That pin is Astrid's, and applies only when deploying to Astrid's Vercel team
 * (AWTD-1280). A partner deploying from their own account (`--team` / `--scope`,
 * or VERCEL_TEAM_ID / VERCEL_SCOPE — scripts/lib/vercel-target.ts) has their own
 * database, where the profile's agent domain is the right one.
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
import { profileEnv, type BrandProfile } from '../lib/brand/profile'
import { previewPins, resolveVercelTarget, VERCEL_TARGET_FLAGS, type VercelTarget } from './lib/vercel-target'

loadScriptEnv()

const args = process.argv.slice(2)
const aliasAt = args.indexOf('--alias')
const alias = aliasAt === -1 ? null : args[aliasAt + 1]
if (aliasAt !== -1 && (!alias || alias.startsWith('--'))) {
  console.error('--alias requires a hostname, e.g. --alias whitelabel.astrid.cc')
  process.exit(1)
}

let target: VercelTarget
try {
  target = resolveVercelTarget(args)
} catch (error) {
  console.error(`❌ ${error instanceof Error ? error.message : error}`)
  process.exit(1)
}

/**
 * Forced to a fixed value on previews regardless of what the profile asks for, because
 * on Astrid's team the profile's value would cause writes to the shared production
 * database. Empty on a partner's own team.
 */
const PINNED_FOR_PREVIEW = previewPins(target)

const valueFlags: string[] = ['--alias', ...VERCEL_TARGET_FLAGS]
const profileName = args.find((arg, i) => !arg.startsWith('--') && !valueFlags.includes(args[i - 1]))
if (!profileName) {
  console.error('Usage: npx tsx scripts/deploy-brand-preview.ts <profile> [--alias <hostname>] [--team <id>] [--scope <slug>]')
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

const profile = JSON.parse(readFileSync(profilePath, 'utf8')) as BrandProfile

// Shared with the brand matrix tests so a deploy and a test apply a profile identically.
const resolvedEnv = profileEnv(profile)

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

for (const [key, value] of Object.entries(resolvedEnv)) {
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
  ['vercel', '--yes', '--token', token, '--scope', target.scope, ...buildEnvArgs],
  { encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] }
)

const url = output.match(/https:\/\/[a-z0-9-]+\.vercel\.app/)?.[0]
console.log(output.trim())
if (url) {
  console.log(`\n✅ ${profile.name} preview: ${url}`)
  console.log(`   Verify:  curl -s ${url}/api/v1/capabilities | python3 -m json.tool`)
  if (alias) {
    execFileSync(
      'npx',
      ['vercel', 'alias', url, alias, '--token', token, '--scope', target.scope],
      { encoding: 'utf8', stdio: ['inherit', 'inherit', 'inherit'] }
    )
    console.log(`\n🔗 ${profile.name} is live at https://${alias}`)
  }
} else if (alias) {
  console.error(`❌ Could not find the deployment URL in Vercel's output, so ${alias} was NOT aliased.`)
  process.exit(1)
}
