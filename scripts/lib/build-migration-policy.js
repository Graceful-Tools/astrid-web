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

  return { migrate: true, reason: 'Vercel production build with DATABASE_URL set.' }
}

module.exports = { migrationPlan }
