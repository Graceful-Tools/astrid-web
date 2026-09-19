/**
 * Which pending migrations must not be applied before the code is live.
 *
 * WHY THIS EXISTS (AWTD-959). The production pipeline runs `database-migration`
 * BEFORE `deploy-production`, and the two jobs are independent. On 2026-09-18
 * that ordering caused a real outage:
 *
 *   1. The migration job applied 20260917120000_drop_tasklist_status_columns —
 *      four `DROP COLUMN`s on `TaskList`.
 *   2. The deploy job hung and was cancelled.
 *   3. Production kept serving the OLD build, whose Prisma client still selects
 *      those four columns.
 *   4. Every list read 500'd, and the migration is irreversible, so "roll back
 *      the deploy" would not have fixed it either.
 *
 * This is the standard expand/contract hazard. A contract step — a drop, a
 * rename, a new NOT NULL — is only safe once the code that stopped depending on
 * the old shape is ALREADY LIVE. The pipeline cannot guarantee that ordering, so
 * the answer is to refuse the combination rather than to hope: ship the code
 * first, verify it, then deploy again carrying the migration. AWTD-853 did
 * exactly that for steps 1 and 2; only step 3 skipped it.
 *
 * The detection is a pure function over SQL text so it can be tested. The CI
 * step around it needs a database to learn which migrations are pending, and a
 * rule nobody can run a test against is how the inline URL regex in this same
 * workflow stayed wrong for a whole CI cycle (scripts/extract-preview-url.sh).
 */

/** A contract-breaking statement, named so the failure message can quote it. */
export interface DestructiveStatement {
  kind:
    | 'DROP TABLE'
    | 'DROP COLUMN'
    | 'RENAME COLUMN'
    | 'RENAME TABLE'
    | 'RENAME TYPE'
    | 'SET NOT NULL'
  /** The table it acts on, when the statement names one. */
  table?: string
  /** The column it acts on, for the column-level kinds. */
  column?: string
  /** The offending SQL, collapsed to one line for printing. */
  statement: string
  /** Why this one cannot apply before the new code is live. */
  why: string
}

export interface MigrationSource {
  name: string
  sql: string
}

export interface DestructiveFinding {
  migration: string
  statements: DestructiveStatement[]
}

/**
 * Remove comments before matching anything.
 *
 * Every migration in this repo carries a long prose header, and the ones that
 * drop things describe the drop in words first — including drops that a LATER
 * migration will perform. Matching those would block every deploy.
 *
 * This does not attempt to respect `--` inside a string literal. No migration
 * here has one, and the failure mode is a spurious block that a human reads,
 * not a silent pass.
 */
function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
}

/** Split on `;` and drop the blank remainders. */
function statements(sql: string): string[] {
  return stripComments(sql)
    .split(';')
    .map(s => s.trim())
    .filter(Boolean)
}

/** Collapse whitespace so a statement spanning lines prints on one. */
function oneLine(statement: string): string {
  return statement.replace(/\s+/g, ' ').trim()
}

/** An identifier, quoted or bare, with the quotes discarded. */
const IDENT = String.raw`"([^"]+)"|([A-Za-z_][A-Za-z0-9_$]*)`

function ident(quoted: string | undefined, bare: string | undefined): string | undefined {
  return quoted ?? bare
}

const TABLE_OF_ALTER = new RegExp(String.raw`^\s*ALTER\s+TABLE\s+(?:ONLY\s+)?(?:${IDENT})`, 'i')

function alteredTable(statement: string): string | undefined {
  const match = TABLE_OF_ALTER.exec(statement)
  return match ? ident(match[1], match[2]) : undefined
}

const WHY = {
  dropTable:
    'the old code still reading this table 500s the moment it is gone, and the ' +
    'drop is irreversible — the new code must already be live',
  dropColumn:
    'the old code\'s Prisma client still selects this column, so every read of ' +
    'the table fails until the new code is live (this is what happened on 2026-09-18)',
  rename:
    'a rename is a drop and an add at once: the old code still reading the old ' +
    'name fails until the new code is live',
  renameType:
    'the old code still names this enum type in its generated client, so its ' +
    'reads and writes of the column fail until the new code is live',
  notNull:
    'the old code still writes rows without this column set, so its inserts ' +
    'start failing until the new code is live',
} as const

/**
 * Find the contract-breaking statements in one migration's SQL.
 *
 * Deliberately NOT flagged, because neither can make the old code's queries
 * fail: `DROP INDEX` (a query-plan regression at worst) and `DROP CONSTRAINT`
 * (removing a restriction). Flagging them would make this gate cry wolf on the
 * common case — the migration from the outage drops an index too.
 */
export function findDestructiveStatements(sql: string): DestructiveStatement[] {
  const found: DestructiveStatement[] = []

  for (const statement of statements(sql)) {
    const line = oneLine(statement)
    const table = alteredTable(statement)

    // DROP TABLE "X" — but never DROP INDEX, and never a bare DROP CONSTRAINT.
    const dropTable = new RegExp(
      String.raw`\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:${IDENT})`,
      'i',
    ).exec(statement)
    if (dropTable) {
      found.push({
        kind: 'DROP TABLE',
        table: ident(dropTable[1], dropTable[2]),
        statement: line,
        why: WHY.dropTable,
      })
    }

    // One ALTER TABLE may drop several columns, so this matches globally.
    const dropColumn = new RegExp(
      String.raw`\bDROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?(?:${IDENT})`,
      'gi',
    )
    for (const match of statement.matchAll(dropColumn)) {
      found.push({
        kind: 'DROP COLUMN',
        table,
        column: ident(match[1], match[2]),
        statement: line,
        why: WHY.dropColumn,
      })
    }

    // RENAME COLUMN before RENAME TO: the column form contains a ` TO ` as well.
    const renameColumn = new RegExp(
      String.raw`\bRENAME\s+COLUMN\s+(?:${IDENT})\s+TO\s+(?:${IDENT})`,
      'i',
    ).exec(statement)
    if (renameColumn) {
      found.push({
        kind: 'RENAME COLUMN',
        table,
        column: ident(renameColumn[1], renameColumn[2]),
        statement: line,
        why: WHY.rename,
      })
    } else if (new RegExp(String.raw`\bRENAME\s+TO\s+(?:${IDENT})`, 'i').test(statement)) {
      // WHAT is being renamed decides whether this breaks anything. Only two
      // kinds do. `ALTER INDEX ... RENAME TO` and `ALTER SEQUENCE ... RENAME TO`
      // are invisible to the client, and flagging them would block a deploy
      // over a tidy-up — the failure mode that makes a gate get switched off.
      if (/^\s*ALTER\s+TABLE\b/i.test(statement)) {
        found.push({ kind: 'RENAME TABLE', table, statement: line, why: WHY.rename })
      } else if (/^\s*ALTER\s+TYPE\b/i.test(statement)) {
        found.push({ kind: 'RENAME TYPE', statement: line, why: WHY.renameType })
      }
    }

    // `ALTER COLUMN ... SET NOT NULL` only. An additive
    // `ADD COLUMN "x" BOOLEAN NOT NULL DEFAULT false` also contains "NOT NULL"
    // and is perfectly safe; a detector that matched the words alone would fail
    // every ordinary migration.
    const setNotNull = new RegExp(
      String.raw`\bALTER\s+(?:COLUMN\s+)?(?:${IDENT})\s+SET\s+NOT\s+NULL`,
      'gi',
    )
    for (const match of statement.matchAll(setNotNull)) {
      found.push({
        kind: 'SET NOT NULL',
        table,
        column: ident(match[1], match[2]),
        statement: line,
        why: WHY.notNull,
      })
    }
  }

  return found
}

/** Scan a set of migrations, keeping only the ones with something to report. */
export function findDestructiveMigrations(migrations: MigrationSource[]): DestructiveFinding[] {
  return migrations
    .map(migration => ({
      migration: migration.name,
      statements: findDestructiveStatements(migration.sql),
    }))
    .filter(finding => finding.statements.length > 0)
}

/**
 * Read the pending migration names out of `prisma migrate status` output.
 *
 * Prisma has no machine-readable form of this, so the shape is pinned by test
 * against the real output rather than assumed. Two traps: the `N migrations
 * found in prisma/migrations` count line looks like a numbered name, and the
 * trailing `To apply migrations ... run prisma migrate deploy.` advice follows
 * the list.
 */
export function parsePendingMigrations(output: string): string[] {
  const lines = output.split('\n').map(line => line.trim())
  const header = lines.findIndex(line => /have not yet been applied/i.test(line))
  if (header === -1) return []

  const pending: string[] = []
  for (const line of lines.slice(header + 1)) {
    // A migration directory is a timestamp and a name, with nothing else on the
    // line. Anything else ends the list — including the blank line before the
    // advice that follows it.
    if (!/^\d{8,14}_\S*$/.test(line)) break
    pending.push(line)
  }
  return pending
}
