/**
 * The re-encryption pass itself: page every store in lib/reencrypt-plan.ts and
 * rewrite each value under the current key (task AWTD-1369).
 *
 * Two callers, one pass. scripts/reencrypt-fields.ts runs it against a database
 * named on the command line; /api/admin/encryption-rotation runs it inside
 * production, which is the only place production's keys exist — both are
 * write-only Vercel Secrets, and no machine outside holds either.
 *
 * Counts only. A failure is reported by location (`AddressBookContact.name
 * id=…`), never by value, so the result is safe to log and to return to an
 * admin.
 */
import type { PrismaClient } from '@prisma/client'
import {
  ENCRYPTED_COLUMNS,
  addOutcome,
  emptyOutcome,
  planColumn,
  planMcpSettings,
  type RowOutcome,
} from '@/lib/reencrypt-plan'

export interface ReencryptOptions {
  /** Count what would change, write nothing. */
  dryRun: boolean
  /**
   * Plan as `--verify` does: a legacy CBC credential counts as failed. The
   * keyring is whatever the environment holds, so narrowing it to the current
   * key is the caller's job (the script does it; production uses the census).
   */
  verify: boolean
  batchSize: number
}

export interface ReencryptReporter {
  /** One store finished, with its counts. */
  table(table: string, outcome: RowOutcome): void
  /** A value the pass could not convert, by location — never by value. */
  problem(location: string): void
}

const silent: ReencryptReporter = { table() {}, problem() {} }

/**
 * AI credentials inside `User.mcpSettings` (AWTD-1380) — a JSON blob, so not
 * reachable by the column walker. Same paging, same compare-and-swap, same
 * counts-only output.
 */
async function walkMcpSettings(
  prisma: PrismaClient,
  options: ReencryptOptions,
  reporter: ReencryptReporter,
): Promise<RowOutcome> {
  const { decryptCredentialStrict, encryptCredential } = await import('@/lib/ai/credential-cipher')
  const { encryptionKeyHexes } = await import('@/lib/encryption-keys')
  const keyHexes = encryptionKeyHexes()

  let outcome = emptyOutcome()
  let cursor: string | undefined
  for (;;) {
    const rows = await prisma.user.findMany({
      where: { mcpSettings: { not: null } },
      select: { id: true, mcpSettings: true },
      orderBy: { id: 'asc' },
      take: options.batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
    if (rows.length === 0) break

    for (const row of rows) {
      const plan = planMcpSettings(row.mcpSettings, {
        decrypt: triple => decryptCredentialStrict(triple, keyHexes),
        encrypt: encryptCredential,
        requireAuthenticated: options.verify,
      })
      for (const problem of plan.problems) {
        reporter.problem(`User.mcpSettings id=${row.id} ${problem}`)
      }
      if (plan.next !== undefined && !options.dryRun && !options.verify) {
        const { count } = await prisma.user.updateMany({
          where: { id: row.id, mcpSettings: row.mcpSettings },
          data: { mcpSettings: plan.next },
        })
        if (count === 0) {
          plan.outcome.conflicts += plan.outcome.rewritten
          plan.outcome.rewritten = 0
        }
      }
      outcome = addOutcome(outcome, plan.outcome)
    }
    cursor = rows[rows.length - 1].id
  }

  reporter.table('User.mcpSettings', outcome)
  return outcome
}

/** Every column in ENCRYPTED_COLUMNS, paged by cursor. */
async function walkColumns(
  prisma: PrismaClient,
  options: ReencryptOptions,
  reporter: ReencryptReporter,
): Promise<RowOutcome> {
  const fe = await import('@/lib/field-encryption')
  let total = emptyOutcome()

  for (const table of ENCRYPTED_COLUMNS) {
    const model = (prisma as unknown as Record<string, any>)[table.model]
    if (!model) throw new Error(`No Prisma model named ${table.model}`)

    let outcome = emptyOutcome()
    let cursor: string | undefined

    for (;;) {
      const rows: Record<string, unknown>[] = await model.findMany({
        select: Object.fromEntries(
          [table.cursor, ...table.columns].map(column => [column, true]),
        ),
        orderBy: { [table.cursor]: 'asc' },
        take: options.batchSize,
        ...(cursor ? { cursor: { [table.cursor]: cursor }, skip: 1 } : {}),
      })
      if (rows.length === 0) break

      for (const row of rows) {
        const updates: Record<string, string> = {}
        const rowOutcome: RowOutcome = emptyOutcome()

        for (const column of table.columns) {
          const plan = planColumn(row[column], {
            isEncrypted: fe.isEncrypted,
            decrypt: fe.decryptField,
            encrypt: fe.encryptField,
          })
          if ('next' in plan) {
            updates[column] = plan.next
            rowOutcome.rewritten++
          } else if ('failed' in plan) {
            rowOutcome.failed++
            // The id, never the value — knowing which row to look at is the
            // whole point, and the value is a user's secret.
            reporter.problem(`${table.table}.${column} id=${row[table.cursor]} no key decrypts it`)
          } else {
            rowOutcome.skipped++
          }
        }

        if (!options.dryRun && !options.verify && Object.keys(updates).length > 0) {
          // Compare-and-swap: write only if every column still holds what was
          // read. A token the app refreshed meanwhile is already under the
          // current key; overwriting it would roll it back (AWTD-1380).
          const { count } = await model.updateMany({
            where: {
              [table.cursor]: row[table.cursor] as string,
              ...Object.fromEntries(Object.keys(updates).map(column => [column, row[column]])),
            },
            data: updates,
          })
          if (count === 0) {
            rowOutcome.conflicts += rowOutcome.rewritten
            rowOutcome.rewritten = 0
          }
        }
        outcome = addOutcome(outcome, rowOutcome)
      }

      cursor = rows[rows.length - 1][table.cursor] as string
    }

    reporter.table(table.table, outcome)
    total = addOutcome(total, outcome)
  }
  return total
}

/**
 * The whole pass against one database: every column, then every mcpSettings
 * blob. tests/integration/postgres-risk.test.ts proves it on a real database.
 */
export async function reencrypt(
  prisma: PrismaClient,
  options: ReencryptOptions,
  reporter: ReencryptReporter = silent,
): Promise<RowOutcome> {
  return addOutcome(
    await walkColumns(prisma, options, reporter),
    await walkMcpSettings(prisma, options, reporter),
  )
}
