/**
 * Every FEATURE_KEY needs a seeded FeatureFlag row.
 *
 * PUT /api/admin/features only updates existing rows ("Missing seeded feature
 * flag"), so a key added to FEATURE_KEYS without a migration INSERT shows an
 * admin page whose Save throws. task_cost shipped that way; production had no
 * row for it as of 2026-10-07.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { FEATURE_KEYS } from '@/lib/feature-flags'

const MIGRATIONS = join(process.cwd(), 'prisma/migrations')

function allMigrationSql(): string {
  return readdirSync(MIGRATIONS)
    .map(dir => join(MIGRATIONS, dir, 'migration.sql'))
    .filter(existsSync)
    .map(file => readFileSync(file, 'utf8'))
    .join('\n')
}

describe('feature flag seed rows', () => {
  const sql = allMigrationSql()
  it.each(FEATURE_KEYS.map(key => [key]))('%s is seeded by a migration', key => {
    const seeded = new RegExp(`INSERT INTO "FeatureFlag"[\\s\\S]*?'${key}'`)
    expect(sql).toMatch(seeded)
  })
})
