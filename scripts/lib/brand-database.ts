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
