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
 * It never prints a plaintext, a key, or any stored value: counts only.
 *
 * Idempotent and resumable. Re-running rewrites already-migrated values with a
 * fresh IV, which costs a write and corrupts nothing, so an interrupted run is
 * safe to repeat.
 */

import { loadScriptEnv } from './lib/load-env'
import {
  ENCRYPTED_COLUMNS,
  addOutcome,
  emptyOutcome,
  planColumn,
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

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  loadScriptEnv()

  // Imported after loadScriptEnv so the keyring and Prisma see the env.
  const { createScriptPrisma } = await import('./lib/script-prisma')
  const fe = await import('../lib/field-encryption')
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
  let total = emptyOutcome()

  try {
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
            await model.update({
              where: { [table.cursor]: row[table.cursor] as string },
              data: updates,
            })
          }
          outcome = addOutcome(outcome, rowOutcome)
        }

        cursor = rows[rows.length - 1][table.cursor] as string
      }

      console.log(
        `   ${table.table.padEnd(22)} rewritten=${outcome.rewritten} skipped=${outcome.skipped} failed=${outcome.failed}`,
      )
      total = addOutcome(total, outcome)
    }
  } finally {
    await prisma.$disconnect()
  }

  const mode = options.verify ? 'verify' : options.dryRun ? 'dry run' : 'rewrite'
  console.log(
    `\n${mode}: rewritten=${total.rewritten} skipped=${total.skipped} failed=${total.failed}`,
  )

  if (total.failed > 0) {
    console.error(
      '\n❌ Some values decrypt under NO key on the ring. Do NOT drop a key.\n' +
        '   Either a key is missing from the environment, or those rows were written\n' +
        '   under a key nobody holds. Resolve them before finishing the rotation.',
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
