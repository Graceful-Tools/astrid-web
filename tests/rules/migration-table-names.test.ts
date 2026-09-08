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

/**
 * The same rule, for INDEX names — a migration may only drop an index that a
 * migration created (task 466c10f1).
 *
 * The table rule above catches `ALTER TABLE "DailyStats"`. It cannot catch
 * `DROP INDEX "UserWebhookConfig_userId_idx"`, because the offending name is
 * not a table name at all. And that is exactly the mistake available here:
 * Prisma names an index after the PHYSICAL table, so a model carrying
 * `@@map("user_webhook_configs")` gets `user_webhook_configs_userId_idx`, and
 * writing the model name instead produces a statement that is valid SQL,
 * targets nothing, and — because a redundant-index cleanup is written with
 * `IF EXISTS` so it can be re-run — SUCCEEDS.
 *
 * That is the dangerous shape. The migration reports success, schema.prisma no
 * longer declares the index, and the index is still there in production doing
 * its write amplification, with nothing left in the repo to say so. It was
 * caught here by hand, in this task, on the one mapped model among seventeen.
 *
 * Checked against the migration HISTORY rather than schema.prisma, because an
 * index being dropped is by definition one the schema no longer declares.
 */
describe('migrations only drop indexes that exist (task 466c10f1)', () => {
  // ALL migration directories, not just the 14-digit ones. The older half of
  // this history is named `YYYYMMDD_thing` — including the migrations that
  // create ChatChannel's, AnalyticsDailyStats' and user_webhook_configs'
  // indexes. Filtering them out made a DROP of any of those look unfounded.
  const dirs = existsSync(MIGRATIONS)
    ? readdirSync(MIGRATIONS).filter(d => /^\d{8}/.test(d)).sort()
    : []

  const recent = dirs.filter(d => /^\d{14}_/.test(d) && d.slice(0, 14) >= CHECK_FROM)

  /** Index names any migration up to and including `upTo` creates. */
  function indexesCreatedBefore(upTo: string): Set<string> {
    const created = new Set<string>()
    for (const dir of dirs) {
      if (dir > upTo) continue
      const file = join(MIGRATIONS, dir, 'migration.sql')
      if (!existsSync(file)) continue
      const sql = readFileSync(file, 'utf8').replace(/--[^\n]*/g, '')
      for (const m of sql.matchAll(
        /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?"([^"]+)"/gi,
      )) {
        created.add(m[1])
      }
    }
    return created
  }

  it('finds migrations to check', () => {
    expect(recent.length).toBeGreaterThan(0)
  })

  it.each(recent)('%s drops only indexes a migration created', dir => {
    const file = join(MIGRATIONS, dir, 'migration.sql')
    if (!existsSync(file)) return

    const sql = readFileSync(file, 'utf8').replace(/--[^\n]*/g, '')
    const dropped = [
      ...sql.matchAll(
        /DROP\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?(?:"[^"]+"\.)?"([^"]+)"/gi,
      ),
    ].map(m => m[1])
    if (dropped.length === 0) return

    const created = indexesCreatedBefore(dir)
    const unknown = dropped.filter(name => !created.has(name))

    expect(
      unknown,
      `${dir} drops ${unknown.map(n => `"${n}"`).join(', ')}, which no migration ` +
        `creates. With IF EXISTS this SUCCEEDS while removing nothing — the ` +
        `schema stops declaring the index and production keeps it. Prisma names ` +
        `an index after the physical table, so check @@map.`,
    ).toEqual([])
  })
})
