/**
 * AWTD-859 — pointing a repo script at production must actually point it at
 * production.
 *
 * The task recorded this command, and two review comments repeated it:
 *
 *   DATABASE_URL="$DATABASE_URL_PROD" npx tsx scripts/reaggregate-analytics.ts --from ... --to ...
 *
 * It does not work. Every repo script calls loadScriptEnv(), which loads
 * .env.local with `override: true` so a stale shell export cannot beat the file
 * (scripts/lib/load-env.ts). That override also clobbers a DELIBERATE one, so
 * the command above silently retargets to .env.local's DATABASE_URL —
 * localhost/astrid_dev — and rebuilds a dev box while printing "Database:
 * localhost/astrid_dev" that nobody reads as a failure, because the run
 * succeeds.
 *
 * scripts/legacy-usage-census.ts and scripts/index-drop-evidence.ts already
 * solved this with a `--prod` flag that reads DATABASE_URL_PROD. This pins the
 * shared helper, and that reaggregate-analytics.ts — the one script whose whole
 * purpose is repairing production — has the flag too.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveDatabaseTarget } from '@/scripts/lib/database-target'

const root = process.cwd()

describe('resolveDatabaseTarget (AWTD-859)', () => {
  it('leaves the default database alone when --prod is absent', () => {
    const target = resolveDatabaseTarget({
      useProd: false,
      env: { DATABASE_URL: 'postgres://dev@localhost/astrid_dev', DATABASE_URL_PROD: 'postgres://p@prod/db' },
    })
    expect(target.url).toBe('postgres://dev@localhost/astrid_dev')
    expect(target.isProduction).toBe(false)
  })

  it('returns DATABASE_URL_PROD when --prod is passed', () => {
    const target = resolveDatabaseTarget({
      useProd: true,
      env: { DATABASE_URL: 'postgres://dev@localhost/astrid_dev', DATABASE_URL_PROD: 'postgres://p@prod/db' },
    })
    expect(target.url).toBe('postgres://p@prod/db')
    expect(target.isProduction).toBe(true)
  })

  it('refuses --prod without DATABASE_URL_PROD rather than falling back to dev', () => {
    expect(() =>
      resolveDatabaseTarget({
        useProd: true,
        env: { DATABASE_URL: 'postgres://dev@localhost/astrid_dev' },
      }),
    ).toThrow(/DATABASE_URL_PROD/)
  })

  it('describes the target by host and database only, never with credentials', () => {
    const target = resolveDatabaseTarget({
      useProd: true,
      env: { DATABASE_URL_PROD: 'postgres://someuser:sup3rsecret@ep-orange.neon.tech/astrid?sslmode=require' },
    })
    expect(target.label).toBe('ep-orange.neon.tech/astrid')
    expect(target.label).not.toContain('sup3rsecret')
    expect(target.label).not.toContain('someuser')
  })

  it('reports an unset or unparseable URL instead of throwing', () => {
    expect(resolveDatabaseTarget({ useProd: false, env: {} }).label).toBe('(DATABASE_URL unset)')
    expect(resolveDatabaseTarget({ useProd: false, env: { DATABASE_URL: 'not a url' } }).label).toBe(
      '(unparseable DATABASE_URL)',
    )
  })
})

describe('scripts that target production use the shared flag (AWTD-859)', () => {
  const scripts = [
    'scripts/reaggregate-analytics.ts',
    'scripts/legacy-usage-census.ts',
    'scripts/index-drop-evidence.ts',
  ]

  for (const script of scripts) {
    it(`${script} resolves its database through the shared helper`, () => {
      const source = readFileSync(join(root, script), 'utf8')
      expect(source).toContain("from './lib/database-target'")
      expect(source).toContain('applyDatabaseTarget')
      expect(source).toContain("'--prod'")
    })

    it(`${script} does not hand-roll the DATABASE_URL_PROD lookup`, () => {
      const source = readFileSync(join(root, script), 'utf8')
      expect(source).not.toMatch(/process\.env\.DATABASE_URL_PROD/)
    })
  }
})
