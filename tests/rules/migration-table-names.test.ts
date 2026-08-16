/**
 * RULE — a migration may only touch tables that exist.
 *
 * WHY THIS FILE EXISTS. `20260816010000_analytics_mac_app_dau` said
 *
 *     ALTER TABLE "DailyStats" ADD COLUMN "dauMacApp" ...
 *
 * There is no DailyStats. The model is AnalyticsDailyStats and carries no
 * @@map, so the name was simply wrong — invisible in review, invisible to tsc,
 * invisible to the whole test suite, and invisible locally because migrations
 * are not applied against the dev database.
 *
 * It failed on production with 42P01, and a failed migration BLOCKS EVERY
 * MIGRATION BEHIND IT. So an analytics column nobody was waiting for stopped an
 * unrelated `User.taskDisplayMode` from being added, and two settings endpoints
 * returned 500 for every user until it was repaired. The blast radius of a
 * typo in one migration is every migration in the same deploy.
 *
 * The check is deliberately dumb — string equality against the model names in
 * schema.prisma — because that is exactly the mistake being made. It is not
 * trying to validate SQL.
 *
 * SCOPED TO MIGRATIONS FROM 2026-08 ONWARD. Older ones reference tables that
 * have since been renamed or dropped, which is legitimate history: a migration
 * is a record of what the schema WAS, and rewriting it to satisfy a rule would
 * be worse than the rule's absence. New migrations are what this catches, and
 * new migrations are where the mistake is still affordable to prevent.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const MIGRATIONS = join(ROOT, 'prisma/migrations')

/** Migrations named on or after this date are checked. See the header. */
const CHECK_FROM = '20260801000000'

/** Every table name Prisma will actually create: model names, or their @@map. */
function schemaTableNames(): Set<string> {
  const schema = readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf8')
  const names = new Set<string>()

  for (const m of schema.matchAll(/^model\s+(\w+)\s*\{/gm)) names.add(m[1])
  // A mapped model's physical table is the @@map value, and the model name is
  // then NOT a table. Both are added rather than swapped: a migration written
  // against either spelling is a separate question from this one, and only the
  // physical name can be wrong in a way this test should fail on.
  for (const m of schema.matchAll(/@@map\("([^"]+)"\)/g)) names.add(m[1])

  return names
}

/** Tables an ALTER TABLE in this SQL touches. */
function alteredTables(sql: string): string[] {
  const stripped = sql.replace(/--[^\n]*/g, '')
  return [...stripped.matchAll(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?"([^"]+)"/gi)].map(m => m[1])
}

describe('migrations only touch tables that exist (task b4591534 / ffa5bbb5)', () => {
  const known = schemaTableNames()

  const recent = existsSync(MIGRATIONS)
    ? readdirSync(MIGRATIONS)
        .filter(d => /^\d{14}_/.test(d) && d.slice(0, 14) >= CHECK_FROM)
        .sort()
    : []

  it('finds migrations to check', () => {
    // A rule that silently checks nothing is worse than no rule.
    expect(recent.length).toBeGreaterThan(0)
  })

  it.each(recent)('%s alters only known tables', dir => {
    const file = join(MIGRATIONS, dir, 'migration.sql')
    if (!existsSync(file)) return

    const sql = readFileSync(file, 'utf8')
    const unknown = alteredTables(sql).filter(t => !known.has(t))

    expect(
      unknown,
      `${dir} alters ${unknown.map(t => `"${t}"`).join(', ')}, which is not a model ` +
        `or @@map in schema.prisma. On deploy this fails with 42P01 and blocks ` +
        `every migration behind it in the same build.`,
    ).toEqual([])
  })
})
