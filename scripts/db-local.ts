/**
 * npm run db:local -- <prisma args>
 *
 * Run a Prisma CLI command against the LOCAL database configured in
 * .env.local, e.g. `npm run db:local -- migrate deploy`.
 *
 * Why this exists: prisma.config.ts loads only `.env` (dotenv/config), so the
 * plain `npm run db:deploy` never sees .env.local. That is deliberate — a
 * .env.local can hold production values (a `vercel env pull` writes them) —
 * but it left no safe way to migrate a local database, and a local
 * `db push`-built database silently drifted 112 migrations behind.
 *
 * This loads .env.local and REFUSES unless every database URL Prisma would
 * use is localhost/127.0.0.1, so it can never be pointed at Neon or
 * production by accident. It prints only Prisma's own output, never a URL.
 */

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { config } from 'dotenv'

/** The env keys Prisma reads (prisma.config.ts: DIRECT first, then pooled). */
export const PRISMA_DATABASE_KEYS = ['DATABASE_URL_DIRECT', 'DATABASE_URL'] as const

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/**
 * Throws unless at least one Prisma database URL is set and every set one is
 * a local host. Error messages name the key, never the value.
 */
export function assertLocalDatabaseUrls(env: Record<string, string | undefined>): void {
  const set = PRISMA_DATABASE_KEYS.filter((k) => env[k])
  if (set.length === 0) {
    throw new Error('db:local: neither DATABASE_URL nor DATABASE_URL_DIRECT is set in .env.local')
  }
  for (const key of set) {
    let host: string
    try {
      host = new URL(env[key]!).hostname.toLowerCase()
    } catch {
      throw new Error(`db:local: ${key} is not a valid URL`)
    }
    if (!LOCAL_HOSTS.has(host)) {
      throw new Error(`db:local: refusing — ${key} does not point at localhost`)
    }
  }
}

function main(): number {
  const repo = path.resolve(__dirname, '..')
  // override: a DATABASE_URL exported in the shell must not win over the file
  // we just checked — the guard would pass on one URL while Prisma used another.
  config({ path: path.join(repo, '.env.local'), override: true, quiet: true })

  try {
    assertLocalDatabaseUrls(process.env)
  } catch (error) {
    console.error((error as Error).message)
    return 2
  }

  const args = process.argv.slice(2)
  if (args.length === 0) {
    console.error('usage: npm run db:local -- <prisma args>   e.g. migrate deploy | migrate status')
    return 1
  }

  const result = spawnSync(
    process.execPath,
    [path.join(repo, 'node_modules/prisma/build/index.js'), ...args],
    { stdio: 'inherit', env: process.env, cwd: repo },
  )
  return result.status ?? 1
}

if (require.main === module) {
  process.exit(main())
}
