#!/usr/bin/env tsx
/**
 * Rewrite every field-encrypted column under the CURRENT encryption key.
 *
 * Step 2 of the ENCRYPTION_KEY rotation (task AWTD-1369). The rotation shape is
 * unusual because production's key is a Vercel Secret whose value cannot be
 * read back, so it cannot be copied into a "previous key" variable:
 *
 *   0. GET /api/admin/encryption-census on production: noKey must be 0, and it
 *      shows which key decrypts what. The Mac may not hold production's key
 *      (on 2026-10-27 it held none), in which case this script cannot decrypt
 *      production's rows from here: every value reports as failed;
 *   1. generate a new key, record it, set it as ENCRYPTION_KEY_NEXT in Vercel;
 *   2. deploy — reads now try both keys, writes use NEXT (lib/encryption-keys.ts);
 *   3. run this, until `--verify` reports 0 failures;
 *   4. set ENCRYPTION_KEY to the new value and delete ENCRYPTION_KEY_NEXT.
 *
 * The old key is never read by a human at any point.
 *
 *   npx tsx scripts/reencrypt-fields.ts --dry-run    # counts, writes nothing
 *   npx tsx scripts/reencrypt-fields.ts              # rewrite
 *   npx tsx scripts/reencrypt-fields.ts --verify     # prove nothing is left
 *
 * The target database is named, not ambient: `--database-url-env <NAME>` picks
 * which environment variable holds the connection string (default
 * `DATABASE_URL`). Exporting `DATABASE_URL` in the shell does NOT work, because
 * scripts/lib/load-env loads `.env.local` with `override: true` and wins — so
 * without this flag the script would silently use the local database while the
 * operator believed otherwise. Pointing it at production is therefore a visible
 * act: `--database-url-env DATABASE_URL_PROD`.
 *
 * It covers every column in lib/reencrypt-plan.ts's ENCRYPTED_COLUMNS and the
 * AI credentials inside `User.mcpSettings` (AWTD-1380), so one `--verify`
 * proves the whole rotation rather than only the column part.
 *
 * It never prints a plaintext, a key, or any stored value: counts only.
 *
 * Idempotent and resumable. Re-running rewrites already-migrated values with a
 * fresh IV, which costs a write and corrupts nothing, so an interrupted run is
 * safe to repeat.
 */

import type { PrismaClient } from '@prisma/client'
import { loadScriptEnv } from './lib/load-env'
import {
  ENCRYPTED_COLUMNS,
  addOutcome,
  emptyOutcome,
  planColumn,
  planMcpSettings,
  type RowOutcome,
} from '../lib/reencrypt-plan'

export interface Options {
  dryRun: boolean
  verify: boolean
  batchSize: number
  /** Name of the env var holding the connection string. */
  databaseUrlEnv: string
}

export function parseArgs(argv: string[]): Options {
  const batchFlag = argv.indexOf('--batch-size')
  const batchSize = batchFlag === -1 ? 500 : Number(argv[batchFlag + 1])
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 5000) {
    throw new Error('--batch-size must be an integer between 1 and 5000')
  }
  const urlFlag = argv.indexOf('--database-url-env')
  const databaseUrlEnv = urlFlag === -1 ? 'DATABASE_URL' : argv[urlFlag + 1]
  if (!databaseUrlEnv || !/^[A-Z][A-Z0-9_]*$/.test(databaseUrlEnv)) {
    throw new Error('--database-url-env must name an environment variable, e.g. DATABASE_URL_PROD')
  }

  return {
    dryRun: argv.includes('--dry-run'),
    verify: argv.includes('--verify'),
    batchSize,
    databaseUrlEnv,
  }
}

function report(table: string, outcome: RowOutcome): void {
  console.log(
    `   ${table.padEnd(22)} rewritten=${outcome.rewritten} skipped=${outcome.skipped} failed=${outcome.failed} conflicts=${outcome.conflicts}`,
  )
}

/**
 * AI credentials inside `User.mcpSettings` (AWTD-1380) — a JSON blob, so not
 * reachable by the column walker. Same paging, same compare-and-swap, same
 * counts-only output.
 */
async function walkMcpSettings(
  prisma: PrismaClient,
  options: Options,
): Promise<RowOutcome> {
  const { decryptCredentialStrict, encryptCredential } = await import('../lib/ai/credential-cipher')
  const { encryptionKeyHexes } = await import('../lib/encryption-keys')
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
        console.error(`   ❌ User.mcpSettings id=${row.id} ${problem}`)
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

  report('User.mcpSettings', outcome)
  return outcome
}

/** Every column in ENCRYPTED_COLUMNS, paged by cursor. */
async function walkColumns(prisma: PrismaClient, options: Options): Promise<RowOutcome> {
  const fe = await import('../lib/field-encryption')
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
            console.error(`   ❌ ${table.table}.${column} id=${row[table.cursor]} no key decrypts it`)
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

    report(table.table, outcome)
    total = addOutcome(total, outcome)
  }
  return total
}

/**
 * The whole pass against one database: every column, then every mcpSettings
 * blob. The keyring is whatever the environment holds when it runs — main()
 * narrows it to the current key for --verify. Exported so
 * tests/integration/postgres-risk.test.ts can prove it on a real database.
 */
export async function reencrypt(prisma: PrismaClient, options: Options): Promise<RowOutcome> {
  return addOutcome(await walkColumns(prisma, options), await walkMcpSettings(prisma, options))
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  loadScriptEnv()

  // Imported after loadScriptEnv so the keyring and Prisma see the env.
  const { createScriptPrisma } = await import('./lib/script-prisma')
  const { encryptionKeyHexes, currentEncryptionKeyHex } = await import('../lib/encryption-keys')

  const keyCount = encryptionKeyHexes().length
  console.log(`🔐 keys on the ring: ${keyCount}${keyCount === 1 ? ' (no rotation in progress)' : ''}`)

  if (options.verify) {
    // Decrypt with the CURRENT key alone. A failure means the value is still
    // under the old key, so the rotation is not finished.
    const only = currentEncryptionKeyHex()
    process.env.ENCRYPTION_KEY = only
    delete process.env.ENCRYPTION_KEY_NEXT
    console.log('🔎 verify: decrypting with the current key ONLY')
  }

  const databaseUrl = process.env[options.databaseUrlEnv]
  if (!databaseUrl) {
    throw new Error(`${options.databaseUrlEnv} is not set`)
  }
  console.log(`🗄️  target: ${options.databaseUrlEnv}`)
  const prisma = createScriptPrisma({ url: databaseUrl })
  let total: RowOutcome

  try {
    total = await reencrypt(prisma, options)
  } finally {
    await prisma.$disconnect()
  }

  const mode = options.verify ? 'verify' : options.dryRun ? 'dry run' : 'rewrite'
  console.log(
    `\n${mode}: rewritten=${total.rewritten} skipped=${total.skipped} failed=${total.failed} conflicts=${total.conflicts}`,
  )
  if (total.conflicts > 0) {
    console.log(
      '\n⚠️  Some rows changed while this ran and were left as the app wrote them.\n' +
        '   Re-run, then --verify.',
    )
  }

  if (total.failed > 0) {
    console.error(
      '\n❌ Some values decrypt under NO key on the ring. Do NOT drop a key.\n' +
        '   Either a key is missing from the environment, or those rows were written\n' +
        '   under a key nobody holds. Resolve them before finishing the rotation.\n' +
        '   An `ambiguous` AI credential is legacy CBC that more than one key decrypts:\n' +
        '   the user re-entering it in Settings → AI Agents is the only safe fix.\n' +
        '   Under --verify, `legacy CBC` means the rewrite has not run (or hit a conflict).',
    )
    process.exit(1)
  }

  if (options.verify) {
    console.log(
      '\n✅ Everything decrypts under the current key alone. Safe to set ENCRYPTION_KEY\n' +
        '   to the new value and delete ENCRYPTION_KEY_NEXT.',
    )
  } else if (!options.dryRun) {
    console.log('\nNext: re-run with --verify to prove nothing is left under the old key.')
  }
}

if (process.argv[1]?.endsWith('reencrypt-fields.ts')) {
  main().catch(error => {
    console.error('❌ re-encryption failed:', error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
