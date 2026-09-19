/**
 * AWTD-959 — a destructive migration must not apply while the code that stops
 * reading the dropped thing is still only *pending*.
 *
 * On 2026-09-18 the `database-migration` job applied
 * 20260917120000_drop_tasklist_status_columns — four `DROP COLUMN`s on
 * `TaskList` — and the `deploy-production` job that carried the matching code
 * then hung and was cancelled. Production was left running the OLD build, whose
 * Prisma client still selects those four columns, and every list read 500'd.
 *
 * This pins the detector that refuses that ordering. It is deliberately a pure
 * function over SQL text: the CI step around it needs a database to learn which
 * migrations are pending, and a rule nobody can run a test against is how the
 * inline URL regex in this same workflow stayed wrong (scripts/extract-preview-url.sh).
 */
import { describe, expect, it } from 'vitest'
import {
  findDestructiveMigrations,
  findDestructiveStatements,
  parsePendingMigrations,
} from '@/scripts/lib/destructive-migrations'

/** The real migration from the outage, trimmed to its statements. */
const AWTD_853_STEP_3 = `
-- The index depends on "statusOrder", so it goes first.
DROP INDEX IF EXISTS "TaskList_projectId_statusOrder_idx";

ALTER TABLE "TaskList" DROP COLUMN IF EXISTS "statusRole";
ALTER TABLE "TaskList" DROP COLUMN IF EXISTS "statusOrder";
ALTER TABLE "TaskList" DROP COLUMN IF EXISTS "statusDescription";
ALTER TABLE "TaskList" DROP COLUMN IF EXISTS "statusCompleted";
`

describe('findDestructiveStatements (AWTD-959)', () => {
  it('flags every DROP COLUMN in the migration that caused the outage', () => {
    const found = findDestructiveStatements(AWTD_853_STEP_3)
    const dropped = found.filter(s => s.kind === 'DROP COLUMN')

    expect(dropped).toHaveLength(4)
    expect(dropped.map(s => s.column)).toEqual([
      'statusRole',
      'statusOrder',
      'statusDescription',
      'statusCompleted',
    ])
    expect(dropped[0].table).toBe('TaskList')
  })

  it('does NOT flag the DROP INDEX in that same migration', () => {
    // An index drop can regress a query plan; it cannot make the old code's
    // SELECT fail. Flagging it would make this gate cry wolf on the common case.
    const kinds = findDestructiveStatements(AWTD_853_STEP_3).map(s => s.kind)
    expect(kinds).not.toContain('DROP INDEX')
  })

  it('flags DROP TABLE', () => {
    const found = findDestructiveStatements('DROP TABLE "Session";')
    expect(found).toHaveLength(1)
    expect(found[0].kind).toBe('DROP TABLE')
    expect(found[0].table).toBe('Session')
  })

  it('flags a renamed column, which breaks the old code exactly like a drop', () => {
    const found = findDestructiveStatements(
      'ALTER TABLE "Task" RENAME COLUMN "dueDate" TO "dueDateTime";',
    )
    expect(found).toHaveLength(1)
    expect(found[0].kind).toBe('RENAME COLUMN')
  })

  it('flags a renamed table', () => {
    const found = findDestructiveStatements('ALTER TABLE "TaskList" RENAME TO "List";')
    expect(found.map(s => s.kind)).toEqual(['RENAME TABLE'])
  })

  it('flags a renamed enum type, which the generated client still names', () => {
    // Real statement from 20260620000000_drop_dead_projects_residue.
    const found = findDestructiveStatements(
      'ALTER TYPE "InvitationType" RENAME TO "InvitationType_old";',
    )
    expect(found.map(s => s.kind)).toEqual(['RENAME TYPE'])
  })

  it('leaves an index or sequence rename alone', () => {
    // Invisible to the Prisma client. Blocking a deploy over a tidy-up is how a
    // gate earns the reputation that gets it switched off.
    expect(
      findDestructiveStatements(`
        ALTER INDEX "Task_listId_idx" RENAME TO "Task_listIds_idx";
        ALTER SEQUENCE "Task_id_seq" RENAME TO "Task_pk_seq";
      `),
    ).toEqual([])
  })

  it('flags SET NOT NULL, because the old code still writes rows without it', () => {
    const found = findDestructiveStatements(
      'ALTER TABLE "Task" ALTER COLUMN "listId" SET NOT NULL;',
    )
    expect(found.map(s => s.kind)).toEqual(['SET NOT NULL'])
  })

  it('leaves an additive ADD COLUMN ... NOT NULL DEFAULT alone', () => {
    // The words "NOT NULL" appear here and the statement is perfectly safe.
    // A detector that matched them would fail every ordinary migration.
    expect(
      findDestructiveStatements(
        'ALTER TABLE "Task" ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT false;',
      ),
    ).toEqual([])
  })

  it('leaves CREATE TABLE, CREATE INDEX and DROP CONSTRAINT alone', () => {
    const additive = `
      CREATE TABLE "Reminder" ("id" TEXT NOT NULL, PRIMARY KEY ("id"));
      CREATE INDEX "Reminder_id_idx" ON "Reminder"("id");
      ALTER TABLE "Task" DROP CONSTRAINT "Task_listId_fkey";
    `
    expect(findDestructiveStatements(additive)).toEqual([])
  })

  it('ignores a DROP COLUMN that is only mentioned in a comment', () => {
    // Every migration in this repo carries a long prose header, and the ones
    // that drop things describe the drop they are NOT doing yet.
    const commented = `
      -- WHAT THIS DESTROYS: nothing yet. Step 3 will DROP COLUMN "statusRole".
      /* A later migration will also DROP TABLE "TaskList". */
      ALTER TABLE "TaskList" ADD COLUMN "archivedAt" TIMESTAMP(3);
    `
    expect(findDestructiveStatements(commented)).toEqual([])
  })

  it('matches regardless of case and of whitespace across lines', () => {
    const found = findDestructiveStatements('alter table "Task"\n  drop column\n  "notes";')
    expect(found.map(s => s.kind)).toEqual(['DROP COLUMN'])
  })

  it('explains why each finding blocks the deploy', () => {
    for (const statement of findDestructiveStatements(AWTD_853_STEP_3)) {
      expect(statement.why).toMatch(/already live|still reading|old code/i)
    }
  })
})

describe('findDestructiveMigrations (AWTD-959)', () => {
  it('reports findings per migration and skips the clean ones', () => {
    const findings = findDestructiveMigrations([
      { name: '20260901000000_add_pinned', sql: 'ALTER TABLE "Task" ADD COLUMN "pinned" BOOLEAN;' },
      { name: '20260917120000_drop_tasklist_status_columns', sql: AWTD_853_STEP_3 },
    ])

    expect(findings).toHaveLength(1)
    expect(findings[0].migration).toBe('20260917120000_drop_tasklist_status_columns')
    expect(findings[0].statements).toHaveLength(4)
  })

  it('is empty for an empty pending set, so an ordinary deploy is never blocked', () => {
    expect(findDestructiveMigrations([])).toEqual([])
  })
})

describe('parsePendingMigrations (AWTD-959)', () => {
  it('reads the names out of `prisma migrate status` output', () => {
    const output = [
      'Prisma schema loaded from prisma/schema.prisma',
      'Datasource "db": PostgreSQL database "astrid", schema "public"',
      '',
      '2 migrations found in prisma/migrations',
      '',
      'Following migrations have not yet been applied:',
      '20260917120000_drop_tasklist_status_columns',
      '20260918090000_add_reminder_table',
      '',
      'To apply migrations in development run prisma migrate dev.',
    ].join('\n')

    expect(parsePendingMigrations(output)).toEqual([
      '20260917120000_drop_tasklist_status_columns',
      '20260918090000_add_reminder_table',
    ])
  })

  it('returns nothing when the database is up to date', () => {
    const output = [
      '3 migrations found in prisma/migrations',
      '',
      'Database schema is up to date!',
    ].join('\n')

    expect(parsePendingMigrations(output)).toEqual([])
  })

  it('does not mistake the "migrations found in" count line for a migration', () => {
    expect(parsePendingMigrations('20 migrations found in prisma/migrations')).toEqual([])
  })

  it('stops at the trailing advice rather than swallowing it', () => {
    const output = [
      'Following migrations have not yet been applied:',
      '20260918090000_add_reminder_table',
      '',
      'To apply migrations in production run prisma migrate deploy.',
    ].join('\n')

    expect(parsePendingMigrations(output)).toEqual(['20260918090000_add_reminder_table'])
  })
})
