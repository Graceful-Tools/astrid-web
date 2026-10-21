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
 *   npx tsx scripts/provision-brand-database.ts --project partner --team team_xxx --scope partner-co
 *   npx tsx scripts/provision-brand-database.ts --name lanes-test --out .env.lanes-test.local
 *
 * Creates the Neon project named after the Vercel project (or reuses one with
 * exactly that name), in --region (default aws-us-west-2, production's), then
 * writes DATABASE_URL (pooled) and DATABASE_URL_DIRECT (direct) to production
 * and preview. Refuses Astrid's own project. Afterwards run push-brand-env.ts,
 * which must report "Database configured"; the first production build then
 * migrates the empty database.
 *
 * The Vercel team is --team / --scope, then VERCEL_TEAM_ID / VERCEL_SCOPE, then
 * Astrid's (scripts/lib/vercel-target.ts, AWTD-1280).
 *
 * --out <path> writes the two URLs to a local, gitignored dotenv file
 * instead of a Vercel project (AWTD-1299), and --name names the Neon project.
 * That is the Astrid-team preview case: a preview of astrid-web that needs a
 * database of its own (the lanes-test preview, AWTD-1284) must not write it into
 * astrid-web's project env, where every preview would pick it up. Previews do
 * not migrate, so migrate it from the file:
 *
 *   (set -a; . ./.env.lanes-test.local; npx prisma migrate deploy)
 *
 * Not `--env-file`: node claims that flag for itself even after the script
 * name, loads the file into this process, and the script never sees it.
 *
 * Needs NEON_API_KEY (org-scoped) in .env.local, and VERCEL_TOKEN unless --out.
 */

import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { loadScriptEnv } from './lib/load-env'
import { resolveVercelTarget, type VercelTarget } from './lib/vercel-target'
import {
  assertPartnerProject,
  databaseEnvRows,
  envFileError,
  findNeonProject,
  upsertDatabaseEnvFile,
  vercelTeamQuery,
  type DatabaseEnvRow,
} from './lib/brand-database'

loadScriptEnv()

const NEON = 'https://console.neon.tech/api/v2'
const VERCEL = 'https://api.vercel.com'
const DATABASE_KEYS = ['DATABASE_URL', 'DATABASE_URL_DIRECT'] as const
const USAGE = [
  'Usage: npx tsx scripts/provision-brand-database.ts --project <vercel-project> [--team <id>] [--scope <slug>] [--region aws-us-west-2] [--dry-run]',
  '       npx tsx scripts/provision-brand-database.ts --name <neon-project> --out .env.<preview>.local [--region aws-us-west-2] [--dry-run]',
].join('\n')

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(name)
  if (i === -1) return undefined
  const value = args[i + 1]
  if (!value || value.startsWith('--')) fail(`❌ ${name} requires a value\n${USAGE}`)
  return value
}
const project = flag('--project')
const envFile = flag('--out')
const neonName = flag('--name') ?? project
const region = flag('--region') ?? 'aws-us-west-2'
const dryRun = args.includes('--dry-run')

if (envFile && project) fail(`❌ --out writes a file instead of a Vercel project; pass --name, not --project.\n${USAGE}`)
if (!neonName || (!envFile && !project)) fail(USAGE)
if (envFile) {
  const reason = envFileError(envFile)
  if (reason) fail(`❌ ${reason}`)
}
for (const key of envFile ? ['NEON_API_KEY'] : ['NEON_API_KEY', 'VERCEL_TOKEN']) {
  if (!process.env[key]) fail(`❌ ${key} not set (expected in .env.local)`)
}

let target: VercelTarget | undefined
if (!envFile) {
  try {
    target = resolveVercelTarget(args)
  } catch (error) {
    fail(`❌ ${error instanceof Error ? error.message : error}`)
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
const vercel = <T>(path: string, init?: RequestInit) =>
  call<T>(VERCEL, process.env.VERCEL_TOKEN!, vercelTeamQuery(path, target!.teamId), init)

interface NeonProject { id: string; name: string; region_id: string; org_id?: string }

/** Where the URLs go: a Vercel project's env, or a local file. Both say up front whether there is anything to do. */
interface Destination {
  label: string
  alreadyProvisioned(): Promise<boolean>
  write(rows: DatabaseEnvRow[]): Promise<void>
}

async function vercelDestination(): Promise<Destination> {
  const vercelProject = await vercel<{ id: string; name: string }>(`/v9/projects/${project}`)
  assertPartnerProject(vercelProject)
  return {
    label: `Vercel "${vercelProject.name}" (${vercelProject.id}, ${target!.scope})`,
    async alreadyProvisioned() {
      const existingEnv = (await vercel<{ envs: Array<{ key: string }> }>(`/v9/projects/${project}/env`)).envs
      return DATABASE_KEYS.every(key => existingEnv.some(row => row.key === key))
    },
    async write(rows) {
      for (const row of rows) {
        await vercel(`/v10/projects/${project}/env?upsert=true`, { method: 'POST', body: JSON.stringify(row) })
      }
    },
  }
}

function fileDestination(path: string): Destination {
  const read = () => (existsSync(path) ? readFileSync(path, 'utf8') : '')
  return {
    label: path,
    async alreadyProvisioned() {
      const lines = read().split('\n')
      return DATABASE_KEYS.every(key => lines.some(line => line.startsWith(`${key}=`)))
    },
    async write(rows) {
      writeFileSync(path, upsertDatabaseEnvFile(read(), rows), { mode: 0o600 })
      chmodSync(path, 0o600)
    },
  }
}

async function main() {
  const destination = envFile ? fileDestination(envFile) : await vercelDestination()

  // Both, not either: a run that died between the two writes must finish the second.
  if (await destination.alreadyProvisioned()) {
    console.log(`✅ ${destination.label} already has DATABASE_URL and DATABASE_URL_DIRECT — nothing to do. (Remove them first to re-provision.)`)
    return
  }

  const { organizations } = await neon<{ organizations: Array<{ id: string; name: string }> }>('/users/me/organizations')
  if (organizations.length !== 1) throw new Error(`Expected the key to belong to one Neon org, found ${organizations.length}.`)
  const org = organizations[0]

  const { projects } = await neon<{ projects: NeonProject[] }>(`/projects?org_id=${org.id}&limit=400`)
  let neonProject = findNeonProject(projects, neonName!)
  console.log(`\n🗄️  Neon (${org.name}) → ${destination.label}${dryRun ? '  [dry run]' : ''}\n`)

  if (neonProject) {
    console.log(`  ↻ reusing Neon project ${neonProject.name} (${neonProject.id}, ${neonProject.region_id})`)
  } else if (dryRun) {
    console.log(`  + would create Neon project ${neonName} in ${region}`)
    console.log('  + would write DATABASE_URL (pooled) and DATABASE_URL_DIRECT (direct)\n')
    return
  } else {
    const created = await neon<{ project: NeonProject }>('/projects', {
      method: 'POST',
      body: JSON.stringify({ project: { name: neonName, region_id: region, org_id: org.id } }),
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

  if (!dryRun) await destination.write(rows)
  for (const row of rows) {
    const where = envFile ? envFile : row.target.join(' + ')
    console.log(`  + ${row.key} = ••• (${row.key === 'DATABASE_URL' ? 'pooled' : 'direct'}, ${where})`)
  }
  console.log(
    envFile
      ? `\n✅ Done. Migrate it: (set -a; . ${envFile}; npx prisma migrate deploy)\n`
      : `\n✅ Done. Next: npx tsx scripts/push-brand-env.ts <profile> --project ${project}${args.includes('--team') ? ` --team ${target!.teamId} --scope ${target!.scope}` : ''}\n`,
  )
}

main().catch(error => {
  console.error(`❌ ${error instanceof Error ? error.message : error}`)
  process.exit(1)
})
