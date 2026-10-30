/**
 * Encryption census (AWTD-1369): which key on production's ring decrypts each
 * stored value — counts only.
 *
 * Production's keys are Vercel Secrets and the Mac's key decrypts none of
 * production's 6274 encrypted contacts, so whether production can still read
 * its own data — and whether ENCRYPTION_KEY_NEXT is already in use — can only
 * be answered from inside production. The census must answer it without ever
 * putting a key or a stored value in its output.
 */
import { describe, it, expect } from 'vitest'
import crypto from 'crypto'
import { namedEncryptionKeys } from '@/lib/encryption-keys'
import { runEncryptionCensus } from '@/lib/encryption-census'
import { ENCRYPTED_COLUMNS } from '@/lib/reencrypt-plan'

const OLD = 'a1'.repeat(32)
const NEW = 'b2'.repeat(32)
const STRAY = 'c3'.repeat(32)

function encryptUnder(keyHex: string, plaintext: string): string {
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv)
  const ct = cipher.update(plaintext, 'utf8', 'hex') + cipher.final('hex')
  return `enc:v1:${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${ct}`
}

/** Just enough of a Prisma model for cursor paging by id. */
function fakeModel(rows: Record<string, unknown>[]) {
  return {
    findMany: async ({ take, cursor }: { take: number; cursor?: { id: string } }) => {
      const sorted = [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)))
      const start = cursor ? sorted.findIndex(r => r.id === cursor.id) + 1 : 0
      return sorted.slice(start, start + take)
    },
  }
}

describe('namedEncryptionKeys (AWTD-1369)', () => {
  it('names each key on the ring and does not throw when the two are identical', () => {
    const ring = namedEncryptionKeys({ ENCRYPTION_KEY: OLD, ENCRYPTION_KEY_NEXT: OLD })
    expect(ring.identical).toBe(true)
    expect(ring.keys.map(k => k.name)).toEqual(['ENCRYPTION_KEY_NEXT', 'ENCRYPTION_KEY'])
  })

  it('reports a malformed key by name and length instead of using it', () => {
    const ring = namedEncryptionKeys({ ENCRYPTION_KEY: OLD, ENCRYPTION_KEY_NEXT: '[SENSITIVE]' })
    expect(ring.keys.map(k => k.name)).toEqual(['ENCRYPTION_KEY'])
    expect(ring.invalid).toEqual([{ name: 'ENCRYPTION_KEY_NEXT', length: 11 }])
  })
})

describe('runEncryptionCensus (AWTD-1369)', () => {
  const contacts = [
    { id: '1', name: encryptUnder(OLD, 'Ada Lovelace'), phoneNumber: encryptUnder(OLD, '+44 7700 900001') },
    { id: '2', name: encryptUnder(NEW, 'Grace Hopper'), phoneNumber: null },
    { id: '3', name: encryptUnder(STRAY, 'Alan Turing'), phoneNumber: 'plain 555' },
  ]
  // Every table the plan names, empty unless seeded — so covering a new store
  // (AWTD-1380 added four) does not need this fake rebuilt by hand.
  const db = {
    ...Object.fromEntries(ENCRYPTED_COLUMNS.map(t => [t.model, fakeModel([])])),
    addressBookContact: fakeModel(contacts),
    user: fakeModel([]),
  }

  it('counts, per column, which named key decrypts each value and how many no key does', async () => {
    const report = await runEncryptionCensus(db, { ENCRYPTION_KEY: OLD, ENCRYPTION_KEY_NEXT: NEW }, 2)
    const name = report.columns.find(c => c.table === 'AddressBookContact' && c.column === 'name')!
    expect(name).toMatchObject({
      encrypted: 3,
      plaintext: 0,
      byKey: { ENCRYPTION_KEY: 1, ENCRYPTION_KEY_NEXT: 1 },
      noKey: 1,
    })
    const phone = report.columns.find(c => c.column === 'phoneNumber')!
    expect(phone).toMatchObject({ encrypted: 1, plaintext: 1, byKey: { ENCRYPTION_KEY: 1, ENCRYPTION_KEY_NEXT: 0 }, noKey: 0 })
    expect(report.totals).toEqual({ encrypted: 4, plaintext: 1, noKey: 1, byKey: { ENCRYPTION_KEY: 2, ENCRYPTION_KEY_NEXT: 1 } })
  })

  it('never puts a key or a stored value in its output', async () => {
    const report = await runEncryptionCensus(db, { ENCRYPTION_KEY: OLD, ENCRYPTION_KEY_NEXT: NEW }, 2)
    const out = JSON.stringify(report)
    for (const secret of [OLD, NEW, 'Ada Lovelace', 'Grace Hopper', 'plain 555', 'enc:v1:']) {
      expect(out).not.toContain(secret)
    }
  })

  it('still runs when the two keys are identical, and says so', async () => {
    const report = await runEncryptionCensus(db, { ENCRYPTION_KEY: OLD, ENCRYPTION_KEY_NEXT: OLD }, 2)
    expect(report.ring.identical).toBe(true)
    expect(report.totals.noKey).toBe(2)
  })
})

/**
 * AWTD-1407: the census also counts the AI credentials inside User.mcpSettings
 * — each `apiKeys[service]` triple and the nested openclaw `authToken` — so an
 * operator can see none is left under the old key before dropping it.
 */
describe('runEncryptionCensus over User.mcpSettings (AWTD-1407)', () => {
  function gcm(keyHex: string, plaintext: string) {
    const iv = crypto.randomBytes(16)
    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv)
    const encrypted = cipher.update(plaintext, 'utf8', 'hex') + cipher.final('hex')
    return { encrypted, iv: iv.toString('hex'), authTag: cipher.getAuthTag().toString('hex') }
  }
  function cbc(keyHex: string, plaintext: string) {
    const iv = crypto.randomBytes(16)
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(keyHex, 'hex'), iv)
    return { encrypted: cipher.update(plaintext, 'utf8', 'hex') + cipher.final('hex'), iv: iv.toString('hex') }
  }

  const users = [
    {
      id: 'u1',
      mcpSettings: JSON.stringify({
        apiKeys: {
          claude: { ...gcm(OLD, 'sk-claude-secret'), isValid: true },
          openai: gcm(NEW, 'sk-openai-secret'),
          openclaw: { ...gcm(NEW, 'wss://gateway.example'), authToken: gcm(OLD, 'gateway-token-secret') },
        },
        theme: 'dark',
      }),
    },
    { id: 'u2', mcpSettings: JSON.stringify({ apiKeys: { gemini: cbc(OLD, 'gemini-legacy-secret') } }) },
    { id: 'u3', mcpSettings: JSON.stringify({ apiKeys: { claude: gcm(STRAY, 'orphaned-secret') } }) },
    { id: 'u4', mcpSettings: 'not json' },
    { id: 'u5', mcpSettings: null },
  ]
  const db = {
    ...Object.fromEntries(ENCRYPTED_COLUMNS.map(t => [t.model, fakeModel([])])),
    user: fakeModel(users),
  }

  it('counts top-level keys and gateway auth tokens by the named key that decrypts them', async () => {
    const report = await runEncryptionCensus(db, { ENCRYPTION_KEY: OLD, ENCRYPTION_KEY_NEXT: NEW }, 2)
    expect(report.mcpSettings).toEqual({
      users: 4,
      invalidJson: 1,
      apiKeys: {
        credentials: 5,
        byKey: { ENCRYPTION_KEY: 2, ENCRYPTION_KEY_NEXT: 2 },
        noKey: 1,
        ambiguous: 0,
        legacyCbc: 1,
      },
      authTokens: {
        credentials: 1,
        byKey: { ENCRYPTION_KEY: 1, ENCRYPTION_KEY_NEXT: 0 },
        noKey: 0,
        ambiguous: 0,
        legacyCbc: 0,
      },
    })
  })

  it('reports legacy CBC that more than one key decrypts as ambiguous, not as either key', async () => {
    const report = await runEncryptionCensus(db, { ENCRYPTION_KEY: OLD, ENCRYPTION_KEY_NEXT: OLD }, 2)
    expect(report.mcpSettings.apiKeys.ambiguous).toBe(1)
    expect(report.mcpSettings.apiKeys.legacyCbc).toBe(0)
  })

  it('never puts a key, a ciphertext or a credential in its output', async () => {
    const out = JSON.stringify(await runEncryptionCensus(db, { ENCRYPTION_KEY: OLD, ENCRYPTION_KEY_NEXT: NEW }, 2))
    for (const secret of [OLD, NEW, 'secret', 'gateway.example', 'u1', 'claude', 'openclaw']) {
      expect(out).not.toContain(secret)
    }
  })
})
