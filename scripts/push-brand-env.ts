#!/usr/bin/env tsx
/**
 * Configure a partner's OWN Vercel project from a brand profile.
 *
 * scripts/deploy-brand-preview.ts is for looking at a brand: a preview of the
 * Astrid project, on Astrid's database, with agent identities pinned to
 * astrid.cc. A partner deployment is a different thing — its own project, its
 * own database, its own domain — and that is the only way to test the whole
 * white-label path end to end: session cookies on the partner's domain, passkeys
 * with the partner's RP ID, agent mailboxes at the partner's agent domain,
 * migrations run against an empty database.
 *
 * This writes the profile's variables to the project's environment (production
 * and preview), so every build of that project is the brand — no --build-env on
 * each deploy, exactly as a partner would run it. It also seeds the server
 * secrets a fresh project lacks, generating them ONLY when absent: overwriting
 * NEXTAUTH_SECRET signs everyone out, and overwriting ENCRYPTION_KEY makes every
 * stored credential unreadable.
 *
 *   npx tsx scripts/push-brand-env.ts whitelabel-partner --project whitelabel-partner
 *   npx tsx scripts/push-brand-env.ts whitelabel-partner --project whitelabel-partner --dry-run
 *
 * The database is NOT set here: attach one to the project (Vercel → Storage →
 * Neon), which sets DATABASE_URL and DATABASE_URL_UNPOOLED; this then maps the
 * latter to the DATABASE_URL_DIRECT the build migrates through.
 *
 * Never prints a secret value. Never touches .env.local (no `vercel env pull`).
 */

import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadScriptEnv } from './lib/load-env'
import { profileEnv, type BrandProfile } from '../lib/brand/profile'

loadScriptEnv()

const TEAM_ID = 'team_gFxp7fWaX7e8tUPt8Vt3YXl0'
const API = 'https://api.vercel.com'

const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(name)
  return i === -1 ? undefined : args[i + 1]
}
const profileName = args.find((arg, i) => !arg.startsWith('--') && args[i - 1] !== '--project')
const project = flag('--project')
const dryRun = args.includes('--dry-run')

if (!profileName || !project) {
  console.error('Usage: npx tsx scripts/push-brand-env.ts <profile> --project <vercel-project> [--dry-run]')
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
const brandEnv = profileEnv(profile)
const domain = brandEnv.NEXT_PUBLIC_BRAND_DOMAIN
if (!domain) {
  console.error('❌ The profile sets no NEXT_PUBLIC_BRAND_DOMAIN — a partner deployment needs its own domain.')
  process.exit(1)
}

interface EnvRow { id: string; key: string; target?: string[] }

async function vercel<T>(path: string, init?: RequestInit): Promise<T> {
  const sep = path.includes('?') ? '&' : '?'
  const response = await fetch(`${API}${path}${sep}teamId=${TEAM_ID}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${init?.method ?? 'GET'} ${path}: HTTP ${response.status} ${JSON.stringify(body).slice(0, 200)}`)
  return body as T
}

async function main() {
  const existing = (await vercel<{ envs: EnvRow[] }>(`/v9/projects/${project}/env`)).envs
  const has = (key: string) => existing.some(row => row.key === key)

  // Brand variables: always written, so the project tracks the profile.
  const writes: Array<{ key: string; value: string; why: string }> = Object.entries(brandEnv).map(
    ([key, value]) => ({ key, value, why: 'profile' }),
  )

  // The origin, from the brand domain. NEXTAUTH_URL drives callbacks and every
  // absolute link; a partner inheriting someone else's would sign in elsewhere.
  writes.push({ key: 'NEXTAUTH_URL', value: `https://${domain}`, why: 'brand domain' })
  writes.push({ key: 'NEXT_PUBLIC_APP_URL', value: `https://${domain}`, why: 'brand domain' })

  // Secrets: generated once, never rotated by this script.
  const secrets: string[] = []
  for (const key of ['NEXTAUTH_SECRET', 'ENCRYPTION_KEY', 'CRON_SECRET', 'INTERNAL_API_SECRET']) {
    if (has(key)) continue
    writes.push({ key, value: randomBytes(32).toString('hex'), why: 'generated (was absent)' })
    secrets.push(key)
  }

  // The Neon integration names the unpooled URL DATABASE_URL_UNPOOLED; the build
  // migrates through DATABASE_URL_DIRECT. Bridge it without copying the value.
  const database = has('DATABASE_URL')
  const direct = has('DATABASE_URL_DIRECT')
  const unpooled = has('DATABASE_URL_UNPOOLED')

  console.log(`\n🎨 ${profile.name} → Vercel project "${project}" (https://${domain})${dryRun ? '  [dry run]' : ''}\n`)
  for (const write of writes) {
    const shown = secrets.includes(write.key) ? '•••' : write.value.length > 60 ? `${write.value.slice(0, 57)}...` : write.value
    console.log(`  ${has(write.key) ? '↻' : '+'} ${write.key} = ${shown}   (${write.why})`)
  }

  if (!dryRun) {
    for (const write of writes) {
      await vercel(`/v10/projects/${project}/env?upsert=true`, {
        method: 'POST',
        body: JSON.stringify({
          key: write.key,
          value: write.value,
          type: write.key.startsWith('NEXT_PUBLIC_') ? 'plain' : 'encrypted',
          target: ['production', 'preview'],
        }),
      })
    }
  }

  if (database && !direct && unpooled) {
    const rows = existing.filter(row => row.key === 'DATABASE_URL_UNPOOLED')
    const decrypted = await vercel<{ value?: string }>(`/v1/projects/${project}/env/${rows[0].id}`)
    if (decrypted.value && !dryRun) {
      await vercel(`/v10/projects/${project}/env?upsert=true`, {
        method: 'POST',
        body: JSON.stringify({ key: 'DATABASE_URL_DIRECT', value: decrypted.value, type: 'encrypted', target: ['production', 'preview'] }),
      })
    }
    console.log('  + DATABASE_URL_DIRECT = (from DATABASE_URL_UNPOOLED)')
  }

  console.log('')
  if (!database) {
    console.log(`⚠️  No DATABASE_URL yet. Provision one: npx tsx scripts/provision-brand-database.ts --project ${project}`)
    console.log('   (or Vercel → Storage → Create → Neon, then run this again to map the direct URL).')
  } else if (!direct && !unpooled) {
    console.log('⚠️  DATABASE_URL is set but neither DATABASE_URL_DIRECT nor DATABASE_URL_UNPOOLED is — migrations need one.')
  } else {
    console.log('✅ Database configured. Deploy with: npx vercel --prod --yes --scope gracefultools  (from a checkout linked to this project)')
  }
}

main().catch(error => {
  console.error(`❌ ${error instanceof Error ? error.message : error}`)
  process.exit(1)
})
