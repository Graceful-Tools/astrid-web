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
 * DATA REWRITES (AWTD-1680). Jon, 2026-11-15: additive migrations ship
 * autonomously; destructive OR DATA-REWRITING ones wait for him. An `UPDATE`,
 * `DELETE` or `TRUNCATE` breaks no query, but it changes production rows in a
 * way no redeploy undoes — so it needs the same explicit "yes" as a DROP.
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
    | 'UPDATE'
    | 'DELETE'
    | 'TRUNCATE'
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
 * Remove comments and literal text before matching anything.
 *
 * Every migration in this repo carries a long prose header, and the ones that
 * drop things describe the drop in words first — including drops that a LATER
 * migration will perform. Matching those would block every deploy. String
 * literals get the same treatment (AWTD-1680): seeded copy or a `COMMENT ON`
 * that says "DELETE" is text, not a statement.
 *
 * A single pass, because the three interact: `--` inside a string is not a
 * comment, and a `'` inside a comment opens no string.
 *
 * Dollar-quoted bodies split two ways. A function or trigger body is stored,
 * not run, so it is dropped — its inner `;`s would otherwise split it into
 * fake statements. A `DO $$ ... $$` body RUNS at migration time, so its text is
 * kept (sanitised the same way) with its `;`s turned into spaces: the block
 * stays one statement starting with `DO`, which `findDestructiveStatements`
 * searches unanchored.
 */
function sanitize(sql: string): string {
  let out = ''
  let i = 0
  while (i < sql.length) {
    const ch = sql[i]
    const next = sql[i + 1]
    if (ch === '-' && next === '-') {
      const end = sql.indexOf('\n', i)
      i = end === -1 ? sql.length : end
      out += ' '
    } else if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2)
      i = end === -1 ? sql.length : end + 2
      out += ' '
    } else if (ch === "'") {
      // `''` is an escaped quote inside the literal, not its end.
      i++
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") i += 2
        else if (sql[i] === "'") break
        else i++
      }
      i++
      out += "''"
    } else if (ch === '"') {
      // A quoted identifier is kept verbatim: the detector reads table names.
      const end = sql.indexOf('"', i + 1)
      const stop = end === -1 ? sql.length : end + 1
      out += sql.slice(i, stop)
      i = stop
    } else if (ch === '$' && /^\$[A-Za-z_]?[A-Za-z0-9_]*\$/.test(sql.slice(i))) {
      const tag = /^\$[A-Za-z_]?[A-Za-z0-9_]*\$/.exec(sql.slice(i))![0]
      const end = sql.indexOf(tag, i + tag.length)
      const body = sql.slice(i + tag.length, end === -1 ? sql.length : end)
      i = end === -1 ? sql.length : end + tag.length
      out += /\bDO\s*$/i.test(out) ? ` ${sanitize(body).replace(/;/g, ' ')} ` : ' $$ '
    } else {
      out += ch
      i++
    }
  }
  return out
}

/** Split on `;` and drop the blank remainders. */
function statements(sql: string): string[] {
  return sanitize(sql)
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

/** An optionally schema-qualified name; the table is the last part. */
const QUALIFIED = String.raw`(?:(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)\s*\.\s*)?(?:${IDENT})`

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
  rewrite:
    'it rewrites production rows when the migration job runs, before the new ' +
    'code is live, and no redeploy restores them — Jon reviews data rewrites',
  delete:
    'it deletes production rows when the migration job runs, before the new ' +
    'code is live, and no redeploy restores them — Jon reviews data rewrites',
} as const

/**
 * Data rewrites: UPDATE, DELETE, TRUNCATE (AWTD-1680).
 *
 * Anchored at the start of a statement (or of a writable `WITH`), never matched
 * as bare words: every Prisma relation migration says `ON DELETE CASCADE ON
 * UPDATE CASCADE`, and a trigger says `AFTER UPDATE OR DELETE ON`. A `DO` block
 * is the exception — its body runs, and is searched anywhere — as is an upsert's
 * `ON CONFLICT ... DO UPDATE`, which rewrites the rows it collides with.
 */
const UPDATE_STMT = new RegExp(String.raw`\bUPDATE\s+(?:ONLY\s+)?${QUALIFIED}(?:\s+(?:AS\s+)?[A-Za-z_]\w*)?\s+SET\b`, 'i')
const DELETE_STMT = new RegExp(String.raw`\bDELETE\s+FROM\s+(?:ONLY\s+)?${QUALIFIED}`, 'i')
const TRUNCATE_STMT = new RegExp(String.raw`\bTRUNCATE\s+(?:TABLE\s+)?(?:ONLY\s+)?${QUALIFIED}`, 'i')

function dataRewrites(statement: string, line: string): DestructiveStatement[] {
  const leading = /^\s*(\w+)/.exec(statement)?.[1]?.toUpperCase()
  // Where the verbs may appear: at the head of the statement, anywhere in a
  // writable CTE or a DO block, and nowhere else.
  const anywhere = leading === 'WITH' || leading === 'DO'
  const at = (re: RegExp) => {
    const match = re.exec(statement)
    if (!match) return null
    if (!anywhere && statement.slice(0, match.index).trim() !== '') return null
    return match
  }

  const found: DestructiveStatement[] = []
  const update = at(UPDATE_STMT)
  if (update) {
    found.push({ kind: 'UPDATE', table: ident(update[1], update[2]), statement: line, why: WHY.rewrite })
  } else if (leading === 'INSERT' && /\bON\s+CONFLICT\b[\s\S]*\bDO\s+UPDATE\b/i.test(statement)) {
    const into = new RegExp(String.raw`\bINTO\s+${QUALIFIED}`, 'i').exec(statement)
    found.push({ kind: 'UPDATE', table: into ? ident(into[1], into[2]) : undefined, statement: line, why: WHY.rewrite })
  }
  const del = at(DELETE_STMT)
  if (del) found.push({ kind: 'DELETE', table: ident(del[1], del[2]), statement: line, why: WHY.delete })
  const truncate = at(TRUNCATE_STMT)
  if (truncate) {
    found.push({ kind: 'TRUNCATE', table: ident(truncate[1], truncate[2]), statement: line, why: WHY.delete })
  }
  return found
}

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

    found.push(...dataRewrites(statement, line))
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
