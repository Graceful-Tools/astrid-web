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
 * The AI credentials inside User.mcpSettings are counted too, per credential
 * kind, since the old key cannot be dropped while any of them needs it
 * (AWTD-1407).
 *
 * Read-only, and its output is counts and variable NAMES only: never a key,
 * never a stored value, never a plaintext.
 */
import { prisma } from '@/lib/prisma'
import { ENCRYPTED_COLUMNS, planMcpSettings } from '@/lib/reencrypt-plan'
import { decryptCredentialStrict } from '@/lib/ai/credential-cipher'
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

/** AI credentials of one kind inside User.mcpSettings (AWTD-1407). */
export interface CredentialCensus {
  credentials: number
  /** Credentials each key decrypts. For legacy CBC, only when it is the ONLY key that does. */
  byKey: KeyCounts
  noKey: number
  /** Legacy CBC that more than one key decrypts, so which key wrote it is unknown. */
  ambiguous: number
  /** Legacy CBC counted in byKey. A rewrite upgrades these to GCM. */
  legacyCbc: number
}

export interface McpSettingsCensus {
  /** Users with mcpSettings set. */
  users: number
  /** Blobs that are not JSON, so none of their credentials could be counted. */
  invalidJson: number
  /** Top-level `apiKeys[service]` credentials. */
  apiKeys: CredentialCensus
  /** Gateway tokens nested at `apiKeys[service].authToken`. */
  authTokens: CredentialCensus
}

export interface EncryptionCensus {
  ring: {
    /** Variable names present and well-formed, in the order reads try them. */
    keys: EncryptionKeyName[]
    invalid: { name: EncryptionKeyName; length: number }[]
    identical: boolean
  }
  columns: ColumnCensus[]
  mcpSettings: McpSettingsCensus
  totals: { encrypted: number; plaintext: number; noKey: number; byKey: KeyCounts }
}

/** Just the part of a Prisma model the census pages through. */
interface PageableModel {
  findMany(args: {
    where?: Record<string, unknown>
    select: Record<string, true>
    orderBy: Record<string, 'asc'>
    take: number
    cursor?: Record<string, string>
    skip?: number
  }): Promise<Record<string, unknown>[]>
}

const emptyCounts = (): KeyCounts => ({ ENCRYPTION_KEY_NEXT: 0, ENCRYPTION_KEY: 0 })

const emptyCredentials = (): CredentialCensus => ({
  credentials: 0,
  byKey: emptyCounts(),
  noKey: 0,
  ambiguous: 0,
  legacyCbc: 0,
})

/**
 * Walk User.mcpSettings with the re-encryption pass's own planner, so the
 * census and the rotation agree on what a credential is. The planner's decrypt
 * hook does the counting; its rewritten blob is discarded.
 */
async function censusMcpSettings(
  model: PageableModel,
  ring: ReturnType<typeof namedEncryptionKeys>,
  batchSize: number,
): Promise<McpSettingsCensus> {
  const census: McpSettingsCensus = {
    users: 0,
    invalidJson: 0,
    apiKeys: emptyCredentials(),
    authTokens: emptyCredentials(),
  }
  const ringHexes = ring.keys.map(k => k.hex)

  let cursor: string | undefined
  for (;;) {
    const rows = await model.findMany({
      where: { mcpSettings: { not: null } },
      select: { id: true, mcpSettings: true },
      orderBy: { id: 'asc' },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
    if (rows.length === 0) break

    for (const row of rows) {
      if (typeof row.mcpSettings !== 'string' || row.mcpSettings === '') continue
      census.users++
      const plan = planMcpSettings(row.mcpSettings, {
        decrypt: (triple, path) => {
          const tally = path.endsWith('.authToken') ? census.authTokens : census.apiKeys
          tally.credentials++
          const result = decryptCredentialStrict(triple, ringHexes)
          if ('failure' in result) {
            if (result.failure === 'ambiguous') tally.ambiguous++
            else tally.noKey++
          } else {
            const key = ring.keys.find(k => !('failure' in decryptCredentialStrict(triple, [k.hex])))!
            tally.byKey[key.name]++
            if (result.legacy) tally.legacyCbc++
          }
          return result
        },
        encrypt: () => ({ encrypted: '', iv: '' }),
        requireAuthenticated: false,
      })
      if (plan.problems.includes('mcpSettings: not valid JSON')) census.invalidJson++
    }

    cursor = rows[rows.length - 1].id as string
  }

  return census
}

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

  const users = db.user as PageableModel | undefined
  if (!users) throw new Error('No Prisma model named user')
  const mcpSettings = await censusMcpSettings(users, ring, batchSize)

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
    mcpSettings,
    totals,
  }
}
