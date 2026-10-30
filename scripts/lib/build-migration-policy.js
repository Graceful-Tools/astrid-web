/**
 * Decide whether a build may touch the database.
 *
 * `npm run build` is the Vercel build command for EVERY environment, and
 * DATABASE_URL is scoped to production, preview and development with the
 * production value. So "DATABASE_URL is set" — the old condition — is true on a
 * preview deploy holding production credentials (task 2b3e7469). The only thing
 * that stopped a preview from migrating production was that DATABASE_URL_DIRECT
 * happens to be production-only, so Prisma failed with "Environment variable not
 * found". Scope that one variable to preview and every preview deploy migrates
 * production.
 *
 * This is CommonJS because scripts/build-with-migrations.js is, and that script
 * runs before anything is compiled.
 */

/**
 * Is this URL a stand-in rather than a database we may migrate?
 *
 * The deploy workflow's build step passes `postgresql://x:x@localhost:5432/x`
 * because `npx prisma generate` hard-fails (P1012) on a datasource env var that
 * is merely undefined — which is what production's DATABASE_URL becomes once it
 * is a Vercel Secret and `vercel pull` stops emitting it (task bd1e0daa). A
 * Vercel production build never legitimately migrates a database on localhost.
 *
 * An unparseable URL is left alone: Prisma will reject it with a clearer error
 * than this function could, and guessing here would change behaviour for values
 * nobody has characterised.
 */
function isPlaceholderUrl(url) {
  try {
    const host = new URL(url).hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
  } catch {
    return false
  }
}

/** The database on the staging server that every preview shares (AWTD-1373). */
const PREVIEW_DATABASE = 'astrid_preview'

function databaseName(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''))
  } catch {
    return undefined
  }
}

/**
 * A preview build migrates only the preview database. Its URL is a Vercel
 * Secret on astrid-web-preview, so only a build on Vercel can read it; the
 * preview workflow opts in when the PR changes no migrations. The database
 * name is checked too, because a preview build on the production project holds
 * production's URL.
 */
function previewMigrationPlan(env) {
  if (env.ASTRID_MIGRATE_PREVIEW_DB !== '1') {
    return {
      migrate: false,
      reason:
        `VERCEL_ENV is "${env.VERCEL_ENV}", not "production", and the preview workflow did not ` +
        'opt in with ASTRID_MIGRATE_PREVIEW_DB=1.',
    }
  }
  const names = [env.DATABASE_URL, env.DATABASE_URL_DIRECT].map(databaseName)
  if (names.some((name) => name !== PREVIEW_DATABASE)) {
    return {
      migrate: false,
      reason:
        `This preview build opted in, but DATABASE_URL and DATABASE_URL_DIRECT must both name ` +
        `${PREVIEW_DATABASE}, so it will not migrate them.`,
    }
  }
  return { migrate: true, reason: `Preview build opted in, on the ${PREVIEW_DATABASE} database.` }
}

/**
 * @param {{ VERCEL_ENV?: string, DATABASE_URL?: string, DATABASE_URL_DIRECT?: string, ASTRID_MIGRATE_PREVIEW_DB?: string }} env
 * @returns {{ migrate: boolean, reason: string }}
 */
function migrationPlan(env) {
  if (!env.VERCEL_ENV) {
    return {
      migrate: false,
      reason:
        'VERCEL_ENV is unset, so this is not a Vercel production build. ' +
        'Use `npm run db:migrate` locally.',
    }
  }

  if (env.VERCEL_ENV === 'preview') {
    return previewMigrationPlan(env)
  }

  if (env.VERCEL_ENV !== 'production') {
    return {
      migrate: false,
      reason:
        `VERCEL_ENV is "${env.VERCEL_ENV}", not "production". A preview build shares ` +
        'production credentials, so it must never migrate.',
    }
  }

  if (!env.DATABASE_URL) {
    return { migrate: false, reason: 'DATABASE_URL is not set during this build.' }
  }

  if (isPlaceholderUrl(env.DATABASE_URL)) {
    return {
      migrate: false,
      reason:
        'DATABASE_URL points at localhost, so it is the build placeholder rather ' +
        'than a real database. The deploy workflow migrates separately and gates on it.',
    }
  }

  return { migrate: true, reason: 'Vercel production build with DATABASE_URL set.' }
}

module.exports = { migrationPlan }
