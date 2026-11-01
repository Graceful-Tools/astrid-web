/**
 * RULE — search's ILIKE '%term%' has a trigram index to use (AWTD-1452).
 *
 * app/api/v1/search/route.ts matches `contains … mode: 'insensitive'` (which
 * Prisma emits as `ILIKE '%term%'`) on Task.title, Task.description and
 * Comment.content. A B-tree cannot serve a leading wildcard, so before this
 * migration every search was a sequential scan of Task plus a scan of Comment,
 * growing with the corpus. A GIN index with `gin_trgm_ops` can serve ILIKE.
 *
 * This pins both halves, because they have to agree: the migration has to
 * create the indexes, and schema.prisma has to declare them, or
 * `prisma migrate diff` (tests/integration/postgres-risk.test.ts) reports drift
 * and a later `migrate dev` offers to "repair" it by dropping them.
 *
 * It also pins that the migration is additive and safe to re-run: no DROP, and
 * IF NOT EXISTS on the extension and every index.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATIONS = join(process.cwd(), 'prisma/migrations')
const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8')

const trigramMigrations = readdirSync(MIGRATIONS)
  .sort()
  .map(name => join(MIGRATIONS, name, 'migration.sql'))
  .filter(existsSync)
  .map(file => readFileSync(file, 'utf8'))
  .filter(sql => /gin_trgm_ops/.test(sql))

function modelBody(model: string): string {
  const match = schema.match(new RegExp(`^model ${model} \\{([\\s\\S]*?)^\\}`, 'm'))
  if (!match) throw new Error(`model ${model} not found in schema.prisma`)
  return match[1]
}

const INDEXES = [
  { model: 'Task', column: 'title', name: 'Task_title_idx' },
  { model: 'Task', column: 'description', name: 'Task_description_idx' },
  { model: 'Comment', column: 'content', name: 'Comment_content_idx' },
] as const

describe('search has trigram indexes for its ILIKE predicates (AWTD-1452)', () => {
  it('a migration enables pg_trgm idempotently', () => {
    expect(trigramMigrations.join('\n')).toMatch(/CREATE EXTENSION IF NOT EXISTS (")?pg_trgm(")?/)
  })

  for (const { model, column, name } of INDEXES) {
    it(`a migration creates ${name} as a GIN trigram index`, () => {
      expect(trigramMigrations.join('\n')).toMatch(
        new RegExp(
          `CREATE INDEX IF NOT EXISTS "${name}" ON ("public"\\.)?"${model}" USING GIN \\("${column}" gin_trgm_ops\\)`,
        ),
      )
    })

    it(`schema.prisma declares ${model}.${column} as a GIN trigram index`, () => {
      expect(modelBody(model)).toContain(`@@index([${column}(ops: raw("gin_trgm_ops"))], type: Gin)`)
    })
  }

  it('the trigram migration is additive — it drops nothing', () => {
    expect(trigramMigrations.length).toBeGreaterThan(0)
    for (const sql of trigramMigrations) {
      const statements = sql.replace(/--.*$/gm, '')
      expect(statements).not.toMatch(/\bDROP\b/i)
    }
  })
})
