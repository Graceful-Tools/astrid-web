/**
 * RED for task 2b3e7469-9ac5-44ef-a58e-4ec8370e9cc0.
 *
 * scripts/build-with-migrations.js ran `prisma migrate deploy` and then
 * `prisma db push --skip-generate --accept-data-loss` on ANY build where
 * DATABASE_URL was set, with no environment guard. DATABASE_URL is scoped to
 * production, preview AND development with the production value, so the only
 * thing stopping a preview deploy from migrating the production database was
 * that DATABASE_URL_DIRECT happens to be production-only — Prisma then fails
 * with "Environment variable not found". That is load-bearing safety resting on
 * an env-var scope nobody wrote down: scope DATABASE_URL_DIRECT to preview and
 * every preview deploy migrates production.
 *
 * The production deploy does not depend on this block — the `database-migration`
 * job in .github/workflows/production-deployment.yml runs `prisma migrate
 * deploy` itself, and `deploy-production` is gated on it.
 */
import { describe, it, expect } from 'vitest'
import { migrationPlan } from '@/scripts/lib/build-migration-policy'

const PRODUCTION_DB = 'postgresql://user:pw@prod-host:5432/astrid'

describe('migrationPlan (task 2b3e7469)', () => {
  it('migrates on a Vercel production build', () => {
    const plan = migrationPlan({ VERCEL_ENV: 'production', DATABASE_URL: PRODUCTION_DB })
    expect(plan.migrate).toBe(true)
  })

  it('does NOT migrate on a preview build, even holding the production DATABASE_URL', () => {
    const plan = migrationPlan({ VERCEL_ENV: 'preview', DATABASE_URL: PRODUCTION_DB })
    expect(plan.migrate).toBe(false)
    expect(plan.reason).toMatch(/preview/i)
  })

  it('does NOT migrate on a Vercel development build', () => {
    expect(migrationPlan({ VERCEL_ENV: 'development', DATABASE_URL: PRODUCTION_DB }).migrate).toBe(
      false,
    )
  })

  it('does NOT migrate off Vercel, where VERCEL_ENV is unset', () => {
    const plan = migrationPlan({ DATABASE_URL: PRODUCTION_DB })
    expect(plan.migrate).toBe(false)
    expect(plan.reason).toMatch(/VERCEL_ENV/)
  })

  it('does not migrate a production build with no DATABASE_URL', () => {
    const plan = migrationPlan({ VERCEL_ENV: 'production' })
    expect(plan.migrate).toBe(false)
    expect(plan.reason).toMatch(/DATABASE_URL/)
  })

  it('never force-pushes the schema — `db push --accept-data-loss` is gone', () => {
    // It can drop columns, the deploy workflow already fails a build whose
    // schema has drifted from its migrations, and no environment is worth a
    // step that silently deletes production data.
    for (const env of ['production', 'preview', 'development', undefined]) {
      const plan = migrationPlan({ VERCEL_ENV: env, DATABASE_URL: PRODUCTION_DB })
      expect(plan).not.toHaveProperty('dbPush', true)
    }
  })
})

/**
 * RED for task bd1e0daa (scope VERCEL_TOKEN out of the PR workflows).
 *
 * Making production's DATABASE_URL a Vercel *Secret* stops `vercel pull` from
 * emitting it, and `npx prisma generate` — which build-with-migrations.js runs
 * unconditionally — hard-fails on a merely undefined datasource env var
 * (P1012). So the deploy workflow's build step passes the same placeholder
 * `postgresql://x:x@localhost:5432/x` it already uses for the drift check.
 *
 * That placeholder satisfies Prisma, but it also made `migrationPlan` answer
 * `migrate: true` on a Vercel production build — so every green deploy ran
 * `prisma migrate deploy` against localhost, failed, and logged
 * "⚠️  Database migrations did not complete during build". Harmless (the call
 * is non-critical and the `database-migration` job has already migrated and
 * gated the deploy) but it is a warning about production data on a deploy that
 * is fine, and this repo has a documented history of deploy rules going wrong
 * by misreading exactly these logs.
 *
 * A Vercel production build never legitimately migrates a database on
 * localhost, so that is the rule.
 */
describe('migrationPlan with a placeholder DATABASE_URL (task bd1e0daa)', () => {
  const PLACEHOLDER = 'postgresql://x:x@localhost:5432/x'

  it('does NOT migrate a production build pointed at the workflow placeholder', () => {
    const plan = migrationPlan({ VERCEL_ENV: 'production', DATABASE_URL: PLACEHOLDER })
    expect(plan.migrate).toBe(false)
    expect(plan.reason).toMatch(/placeholder|localhost/i)
  })

  it('does NOT migrate a production build pointed at 127.0.0.1', () => {
    const plan = migrationPlan({
      VERCEL_ENV: 'production',
      DATABASE_URL: 'postgresql://x:x@127.0.0.1:5432/x',
    })
    expect(plan.migrate).toBe(false)
  })

  it('still migrates a production build pointed at a real host', () => {
    expect(migrationPlan({ VERCEL_ENV: 'production', DATABASE_URL: PRODUCTION_DB }).migrate).toBe(
      true,
    )
  })
})
