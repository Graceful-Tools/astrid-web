/**
 * The decisions behind scripts/provision-brand-database.ts (AWTD-1066), kept
 * pure so they are tested rather than trusted.
 */

/** Astrid's own Vercel project (astrid-web/.vercel/project.json). Never a partner. */
export const ASTRID_VERCEL_PROJECT_ID = 'prj_MUWxfWJ9lIZOi2clHPZhlHsYqSiy'
const ASTRID_VERCEL_PROJECT_NAME = 'astrid-web'

export function assertPartnerProject(project: { id: string; name: string }): void {
  if (project.id === ASTRID_VERCEL_PROJECT_ID || project.name === ASTRID_VERCEL_PROJECT_NAME) {
    throw new Error(`"${project.name}" is Astrid's production project — this script only provisions partner deployments.`)
  }
}

/** Exact name match only: a re-run must reuse its own project and nothing else. */
export function findNeonProject<T extends { name: string }>(projects: T[], name: string): T | undefined {
  return projects.find(project => project.name === name)
}

/** Neon's pooled endpoints carry `-pooler` in the host. */
export function isPooledUri(uri: string): boolean {
  return new URL(uri).hostname.split('.')[0].endsWith('-pooler')
}

export interface DatabaseEnvRow {
  key: 'DATABASE_URL' | 'DATABASE_URL_DIRECT'
  value: string
  type: 'encrypted'
  target: ['production', 'preview']
}

/** Every Vercel call names its team; the team comes from resolveVercelTarget (AWTD-1299). */
export function vercelTeamQuery(path: string, teamId: string): string {
  return `${path}${path.includes('?') ? '&' : '?'}teamId=${encodeURIComponent(teamId)}`
}

/** Files Next or scripts/lib/load-env.ts load on their own: a URL written there replaces the real database. */
const AUTOLOADED_ENV_FILES = new Set(['.env', '.env.local', '.env.development.local', '.env.production.local', '.env.test.local'])

/**
 * Why --out must not write to `path`, or null if it may. The file has to be
 * one nothing loads by itself, and one `.gitignore` covers (`.env*.local`), so the
 * connection strings cannot be committed.
 */
export function envFileError(path: string): string | null {
  const name = path.split(/[\\/]/).pop() ?? ''
  if (AUTOLOADED_ENV_FILES.has(name)) {
    return `${name} is a file the dev server or a repo script loads by itself; use a name like .env.<preview>.local.`
  }
  if (!/^\.env\..+\.local$/.test(name)) {
    return `${name} is not covered by .gitignore (.env*.local), so the URLs could be committed; use .env.<preview>.local.`
  }
  return null
}

/** Sets the two database keys in a dotenv file, in place when present, leaving every other line alone. */
export function upsertDatabaseEnvFile(existing: string, rows: DatabaseEnvRow[]): string {
  const lines = existing === '' ? [] : existing.replace(/\n$/, '').split('\n')
  for (const row of rows) {
    const line = `${row.key}=${JSON.stringify(row.value)}`
    const at = lines.findIndex(l => l.startsWith(`${row.key}=`))
    if (at === -1) lines.push(line)
    else lines[at] = line
  }
  return `${lines.join('\n')}\n`
}

/**
 * Runtime goes through the pooler; the build migrates through the direct host
 * (prisma/schema.prisma `directUrl`). Swapped, migrations fail on the pooler.
 */
export function databaseEnvRows(urls: { pooled: string; direct: string }): DatabaseEnvRow[] {
  if (!isPooledUri(urls.pooled) || isPooledUri(urls.direct)) {
    throw new Error('Expected a pooled DATABASE_URL and a direct DATABASE_URL_DIRECT — the URLs look swapped.')
  }
  return [
    { key: 'DATABASE_URL', value: urls.pooled, type: 'encrypted', target: ['production', 'preview'] },
    { key: 'DATABASE_URL_DIRECT', value: urls.direct, type: 'encrypted', target: ['production', 'preview'] },
  ]
}
