#!/usr/bin/env tsx
/**
 * Give a partner's OWN Vercel project a Neon database of its own (AWTD-1066).
 *
 * The step brands/README.md used to do by hand in the Vercel dashboard
 * (Storage → Create → Neon), done through the Neon and Vercel APIs instead so
 * no connection string ever passes through a chat or a terminal:
 *
 *   npx tsx scripts/provision-brand-database.ts --project whitelabel-partner
 *   npx tsx scripts/provision-brand-database.ts --project whitelabel-partner --dry-run
 *
 * Creates the Neon project named after the Vercel project (or reuses one with
 * exactly that name), in --region (default aws-us-west-2, production's), then
 * writes DATABASE_URL (pooled) and DATABASE_URL_DIRECT (direct) to production
 * and preview. Refuses Astrid's own project. Afterwards run push-brand-env.ts,
 * which must report "Database configured"; the first production build then
 * migrates the empty database.
 *
 * Needs NEON_API_KEY (org-scoped) and VERCEL_TOKEN in .env.local.
 */

import { loadScriptEnv } from './lib/load-env'
import { assertPartnerProject, databaseEnvRows, findNeonProject } from './lib/brand-database'

loadScriptEnv()

const TEAM_ID = 'team_gFxp7fWaX7e8tUPt8Vt3YXl0'
const NEON = 'https://console.neon.tech/api/v2'
const VERCEL = 'https://api.vercel.com'

const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(name)
  return i === -1 ? undefined : args[i + 1]
}
const project = flag('--project')
const region = flag('--region') ?? 'aws-us-west-2'
const dryRun = args.includes('--dry-run')

if (!project) {
  console.error('Usage: npx tsx scripts/provision-brand-database.ts --project <vercel-project> [--region aws-us-west-2] [--dry-run]')
  process.exit(1)
}
for (const key of ['NEON_API_KEY', 'VERCEL_TOKEN']) {
  if (!process.env[key]) {
    console.error(`❌ ${key} not set (expected in .env.local)`)
    process.exit(1)
  }
}

async function call<T>(base: string, token: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json', ...(init?.headers ?? {}) },
  })
  const body = await response.json().catch(() => ({}))
  // Error bodies are echoed truncated; neither API puts a connection string in one.
  if (!response.ok) throw new Error(`${init?.method ?? 'GET'} ${path}: HTTP ${response.status} ${JSON.stringify(body).slice(0, 200)}`)
  return body as T
}
const neon = <T>(path: string, init?: RequestInit) => call<T>(NEON, process.env.NEON_API_KEY!, path, init)
const vercel = <T>(path: string, init?: RequestInit) => {
  const sep = path.includes('?') ? '&' : '?'
  return call<T>(VERCEL, process.env.VERCEL_TOKEN!, `${path}${sep}teamId=${TEAM_ID}`, init)
}

interface NeonProject { id: string; name: string; region_id: string; org_id?: string }

async function main() {
  const target = await vercel<{ id: string; name: string }>(`/v9/projects/${project}`)
  assertPartnerProject(target)

  const existingEnv = (await vercel<{ envs: Array<{ key: string }> }>(`/v9/projects/${project}/env`)).envs
  // Both, not either: a run that died between the two writes must finish the second.
  if (['DATABASE_URL', 'DATABASE_URL_DIRECT'].every(key => existingEnv.some(row => row.key === key))) {
    console.log(`✅ "${project}" already has DATABASE_URL and DATABASE_URL_DIRECT — nothing to do. (Delete them in Vercel first to re-provision.)`)
    return
  }

  const { organizations } = await neon<{ organizations: Array<{ id: string; name: string }> }>('/users/me/organizations')
  if (organizations.length !== 1) throw new Error(`Expected the key to belong to one Neon org, found ${organizations.length}.`)
  const org = organizations[0]

  const { projects } = await neon<{ projects: NeonProject[] }>(`/projects?org_id=${org.id}&limit=400`)
  let neonProject = findNeonProject(projects, project!)
  console.log(`\n🗄️  Neon (${org.name}) → Vercel "${target.name}" (${target.id})${dryRun ? '  [dry run]' : ''}\n`)

  if (neonProject) {
    console.log(`  ↻ reusing Neon project ${neonProject.name} (${neonProject.id}, ${neonProject.region_id})`)
  } else if (dryRun) {
    console.log(`  + would create Neon project ${project} in ${region}`)
    console.log('  + would write DATABASE_URL (pooled) and DATABASE_URL_DIRECT (direct) to production + preview\n')
    return
  } else {
    const created = await neon<{ project: NeonProject }>('/projects', {
      method: 'POST',
      body: JSON.stringify({ project: { name: project, region_id: region, org_id: org.id } }),
    })
    neonProject = created.project
    console.log(`  + created Neon project ${neonProject.name} (${neonProject.id}, ${neonProject.region_id})`)
  }

  const { branches } = await neon<{ branches: Array<{ id: string; default: boolean }> }>(`/projects/${neonProject.id}/branches`)
  const branch = branches.find(b => b.default)
  if (!branch) throw new Error('The Neon project has no default branch.')
  const { databases } = await neon<{ databases: Array<{ name: string; owner_name: string }> }>(
    `/projects/${neonProject.id}/branches/${branch.id}/databases`,
  )
  if (databases.length !== 1) throw new Error(`Expected one database on the default branch, found ${databases.length}.`)
  const db = databases[0]

  const uri = (pooled: boolean) =>
    neon<{ uri: string }>(
      `/projects/${neonProject!.id}/connection_uri?branch_id=${branch.id}&database_name=${encodeURIComponent(db.name)}&role_name=${encodeURIComponent(db.owner_name)}&pooled=${pooled}`,
    ).then(body => body.uri)
  const rows = databaseEnvRows({ pooled: await uri(true), direct: await uri(false) })

  for (const row of rows) {
    if (!dryRun) {
      await vercel(`/v10/projects/${project}/env?upsert=true`, { method: 'POST', body: JSON.stringify(row) })
    }
    console.log(`  + ${row.key} = ••• (${row.key === 'DATABASE_URL' ? 'pooled' : 'direct'}, ${row.target.join(' + ')})`)
  }
  console.log(`\n✅ Done. Next: npx tsx scripts/push-brand-env.ts <profile> --project ${project}\n`)
}

main().catch(error => {
  console.error(`❌ ${error instanceof Error ? error.message : error}`)
  process.exit(1)
})
