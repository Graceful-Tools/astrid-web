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

/**
 * @param {{ VERCEL_ENV?: string, DATABASE_URL?: string }} env
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
