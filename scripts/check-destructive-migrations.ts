#!/usr/bin/env tsx
/**
 * Refuse to apply a destructive migration before the matching code is live.
 *
 * WHY (AWTD-959). `.github/workflows/production-deployment.yml` runs
 * `database-migration` BEFORE `deploy-production`, and the two jobs are
 * independent. On 2026-09-18 the migration job dropped four `TaskList` columns,
 * the deploy job then hung and was cancelled, and production kept serving the
 * OLD build whose Prisma client still selected those columns. Every list read
 * 500'd, and the migration is irreversible.
 *
 * So this runs BEFORE `prisma migrate deploy` and fails the run loudly, naming
 * the statements and the protocol that makes them safe. The detection lives in
 * ./lib/destructive-migrations.ts and is unit-tested; this file is the CLI and
 * the database lookup around it.
 *
 * DELIBERATELY NOT calling loadScriptEnv(). In CI the connection strings come
 * from the job's `env:` block, and the loader applies `.env.local` with
 * `override: true` (scripts/lib/database-target.ts explains the trap) — on a
 * developer machine that would silently retarget the check at the dev database
 * and report a clean bill of health about production. Pass the URL in the
 * environment, as the workflow does.
 *
 * Usage:
 *   npx tsx scripts/check-destructive-migrations.ts
 *   npx tsx scripts/check-destructive-migrations.ts --pending 20260917120000_drop_x
 *   npx tsx scripts/check-destructive-migrations.ts --all      # audit every migration
 *
 * Exit 0 = nothing destructive pending (or ALLOW_DESTRUCTIVE_MIGRATIONS=true).
 * Exit 1 = destructive migration pending, or the pending set could not be read.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  findDestructiveMigrations,
  parsePendingMigrations,
  type MigrationSource,
} from './lib/destructive-migrations'

const MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'migrations')

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  return index === -1 ? undefined : process.argv[index + 1]
}

/** Every migration directory on disk, in application order. */
function allMigrationNames(): string[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
}

function readMigrations(names: string[]): MigrationSource[] {
  return names.flatMap(name => {
    const file = join(MIGRATIONS_DIR, name, 'migration.sql')
    if (!existsSync(file)) {
      console.warn(`⚠️  ${name}: no migration.sql on disk, skipping`)
      return []
    }
    return [{ name, sql: readFileSync(file, 'utf8') }]
  })
}

/**
 * Ask the database which migrations are pending.
 *
 * `prisma migrate status` exits NON-ZERO when migrations are pending, which is
 * the normal case here — so the exit code is not the signal. The output is.
 * Anything we cannot parse is a hard failure: a check that cannot establish
 * safety must not report safety (the pattern behind AWTD-941/943/947).
 */
function pendingFromDatabase(): string[] {
  let output: string
  try {
    output = execFileSync('npx', ['prisma', 'migrate', 'status'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string }
    output = (failure.stdout ?? '') + (failure.stderr ?? '')
  }

  if (/have not yet been applied/i.test(output)) {
    return parsePendingMigrations(output)
  }
  if (/up to date/i.test(output)) {
    return []
  }

  console.error('❌ Could not read migration status from the database.')
  console.error('   Neither "have not yet been applied" nor "up to date" appeared in:')
  console.error(output.trim().split('\n').map(line => `   | ${line}`).join('\n'))
  console.error('')
  console.error('   Refusing to report this deploy safe on an answer nobody got.')
  process.exit(1)
}

function main(): void {
  // `--pending ''` means "nothing is pending" and must NOT fall through to the
  // database, or a caller that says so explicitly gets a different answer than
  // the one it asked for.
  const explicit = argValue('--pending')
  const pending = process.argv.includes('--all')
    ? allMigrationNames()
    : explicit !== undefined
      ? explicit.split(',').map(name => name.trim()).filter(Boolean)
      : pendingFromDatabase()

  if (pending.length === 0) {
    console.log('✅ No pending migrations — nothing destructive can apply in this run.')
    return
  }

  console.log(`🔍 Scanning ${pending.length} pending migration(s) for contract-breaking changes:`)
  for (const name of pending) console.log(`   • ${name}`)

  const findings = findDestructiveMigrations(readMigrations(pending))

  if (findings.length === 0) {
    console.log('✅ All pending migrations are additive — safe to apply before the deploy.')
    return
  }

  const allowed = process.env.ALLOW_DESTRUCTIVE_MIGRATIONS === 'true'

  console.error('')
  console.error('━'.repeat(72))
  console.error('🚨 DESTRUCTIVE MIGRATION PENDING — it must not apply before the code is live')
  console.error('━'.repeat(72))

  for (const finding of findings) {
    console.error('')
    console.error(`  ${finding.migration}`)
    for (const statement of finding.statements) {
      const target = [statement.table, statement.column].filter(Boolean).join('.')
      console.error(`    ${statement.kind}${target ? ` ${target}` : ''}`)
      console.error(`      ${statement.statement}`)
      console.error(`      why: ${statement.why}`)
    }
  }

  console.error('')
  console.error('WHY THIS IS BLOCKED (AWTD-959). This workflow applies migrations in a job that')
  console.error('runs BEFORE the deploy and does not depend on it. On 2026-09-18 the migration')
  console.error('landed, the deploy hung and was cancelled, and production kept serving the old')
  console.error('build against the new schema — every list read 500\'d, with no rollback path,')
  console.error('because a DROP cannot be undone by redeploying.')
  console.error('')
  console.error('THE TWO-DEPLOY PROTOCOL (what AWTD-853 did for its first two steps):')
  console.error('  1. Ship the code that stops depending on the old shape. No migration.')
  console.error('  2. Verify it is live:  curl -s https://astrid.cc/api/health')
  console.error('     and check `commitSha` is the commit you just deployed.')
  console.error('  3. Deploy again, with the migration, once nothing reads the old shape.')
  console.error('')
  console.error('IF STEP 1 IS ALREADY LIVE, this is step 3 and the drop is safe. Re-run the')
  console.error('workflow with `allow_destructive_migrations: true` to say so on the record.')
  console.error('━'.repeat(72))

  if (allowed) {
    console.error('')
    console.error('⚠️  ALLOW_DESTRUCTIVE_MIGRATIONS=true — proceeding, as explicitly requested.')
    return
  }

  process.exit(1)
}

main()
