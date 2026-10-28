/**
 * Encryption census: for every field-encrypted column, how many stored values
 * each key on the ring decrypts — and how many no key does (task AWTD-1369).
 *
 * Production's keys are Vercel Secrets, so they cannot be read back, and the
 * Mac's key decrypts none of production's values. Whether production can still
 * read its own data, and whether ENCRYPTION_KEY_NEXT is already being written,
 * can therefore only be answered from inside production, with production's own
 * keys. This answers it before any rotation step is taken.
 *
 * Read-only, and its output is counts and variable NAMES only: never a key,
 * never a stored value, never a plaintext.
 */
import { prisma } from '@/lib/prisma'
import { ENCRYPTED_COLUMNS } from '@/lib/reencrypt-plan'
import { decryptFieldWithKey, isEncrypted } from '@/lib/field-encryption'
import {
  namedEncryptionKeys,
  type EncryptionEnv,
  type EncryptionKeyName,
} from '@/lib/encryption-keys'

type KeyCounts = Record<EncryptionKeyName, number>

export interface ColumnCensus {
  table: string
  column: string
  /** Values carrying the enc:v1: prefix. */
  encrypted: number
  /** Non-empty values without the prefix (legacy plaintext). */
  plaintext: number
  /** Encrypted values decrypted by each key, first match on the ring wins. */
  byKey: KeyCounts
  /** Encrypted values NO key on the ring decrypts. Anything above 0 is data production cannot read. */
  noKey: number
}

export interface EncryptionCensus {
  ring: {
    /** Variable names present and well-formed, in the order reads try them. */
    keys: EncryptionKeyName[]
    invalid: { name: EncryptionKeyName; length: number }[]
    identical: boolean
  }
  columns: ColumnCensus[]
  totals: { encrypted: number; plaintext: number; noKey: number; byKey: KeyCounts }
}

/** Just the part of a Prisma model the census pages through. */
interface PageableModel {
  findMany(args: {
    select: Record<string, true>
    orderBy: Record<string, 'asc'>
    take: number
    cursor?: Record<string, string>
    skip?: number
  }): Promise<Record<string, unknown>[]>
}

const emptyCounts = (): KeyCounts => ({ ENCRYPTION_KEY_NEXT: 0, ENCRYPTION_KEY: 0 })

export async function runEncryptionCensus(
  db: Record<string, unknown> = prisma as unknown as Record<string, unknown>,
  env?: EncryptionEnv,
  batchSize = 500,
): Promise<EncryptionCensus> {
  const ring = namedEncryptionKeys(env)
  const columns: ColumnCensus[] = []

  for (const table of ENCRYPTED_COLUMNS) {
    const model = db[table.model] as PageableModel | undefined
    if (!model) throw new Error(`No Prisma model named ${table.model}`)

    const counts = new Map<string, ColumnCensus>(
      table.columns.map(column => [
        column,
        { table: table.table, column, encrypted: 0, plaintext: 0, byKey: emptyCounts(), noKey: 0 },
      ]),
    )

    let cursor: string | undefined
    for (;;) {
      const rows = await model.findMany({
        select: Object.fromEntries([table.cursor, ...table.columns].map(c => [c, true] as const)),
        orderBy: { [table.cursor]: 'asc' },
        take: batchSize,
        ...(cursor ? { cursor: { [table.cursor]: cursor }, skip: 1 } : {}),
      })
      if (rows.length === 0) break

      for (const row of rows) {
        for (const column of table.columns) {
          const value = row[column]
          const tally = counts.get(column)!
          if (typeof value !== 'string' || value === '') continue
          if (!isEncrypted(value)) {
            tally.plaintext++
            continue
          }
          tally.encrypted++
          const match = ring.keys.find(key => {
            try {
              decryptFieldWithKey(value, key.hex)
              return true
            } catch {
              return false
            }
          })
          if (match) tally.byKey[match.name]++
          else tally.noKey++
        }
      }

      cursor = rows[rows.length - 1][table.cursor] as string
    }

    columns.push(...counts.values())
  }

  const totals = { encrypted: 0, plaintext: 0, noKey: 0, byKey: emptyCounts() }
  for (const c of columns) {
    totals.encrypted += c.encrypted
    totals.plaintext += c.plaintext
    totals.noKey += c.noKey
    totals.byKey.ENCRYPTION_KEY += c.byKey.ENCRYPTION_KEY
    totals.byKey.ENCRYPTION_KEY_NEXT += c.byKey.ENCRYPTION_KEY_NEXT
  }

  return {
    ring: { keys: ring.keys.map(k => k.name), invalid: ring.invalid, identical: ring.identical },
    columns,
    totals,
  }
}
