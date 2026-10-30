/**
 * Task AWTD-1380. AI credentials live inside `User.mcpSettings`, a JSON blob,
 * so the column walker never reached them and `--verify` could report a
 * finished rotation while every saved AI key was still under the old key.
 *
 * Real ciphers, two real keys: the property under test is "which key", which a
 * stubbed decrypt cannot exercise.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import crypto from 'crypto'
import { planMcpSettings, type McpSettingsDeps } from '@/lib/reencrypt-plan'
import {
  decryptCredential,
  decryptCredentialStrict,
  encryptCredential,
} from '@/lib/ai/credential-cipher'

const OLD = crypto.randomBytes(32).toString('hex')
const NEW = crypto.randomBytes(32).toString('hex')

function underKey<T>(keyHex: string, fn: () => T): T {
  const saved = { k: process.env.ENCRYPTION_KEY, n: process.env.ENCRYPTION_KEY_NEXT }
  process.env.ENCRYPTION_KEY = keyHex
  delete process.env.ENCRYPTION_KEY_NEXT
  try {
    return fn()
  } finally {
    process.env.ENCRYPTION_KEY = saved.k
    if (saved.n === undefined) delete process.env.ENCRYPTION_KEY_NEXT
    else process.env.ENCRYPTION_KEY_NEXT = saved.n
  }
}

function legacyCbc(plaintext: string, keyHex: string, iv = crypto.randomBytes(16)) {
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(keyHex, 'hex'), iv)
  let encrypted = cipher.update(plaintext, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  return { encrypted, iv: iv.toString('hex') }
}

/** The pass mid-rotation: ring = [NEW, OLD], writes under NEW. */
function rotating(requireAuthenticated = false): McpSettingsDeps {
  return {
    decrypt: triple => decryptCredentialStrict(triple, [NEW, OLD]),
    encrypt: plaintext => underKey(NEW, () => encryptCredential(plaintext)),
    requireAuthenticated,
  }
}

/** --verify after the rotation: ring = [NEW] alone. */
function verifying(): McpSettingsDeps {
  return {
    decrypt: triple => decryptCredentialStrict(triple, [NEW]),
    encrypt: plaintext => underKey(NEW, () => encryptCredential(plaintext)),
    requireAuthenticated: true,
  }
}

const readUnderNewOnly = (triple: { encrypted: string; iv: string; authTag?: string }) =>
  underKey(NEW, () => decryptCredential(triple))

describe('planMcpSettings (AWTD-1380)', () => {
  let blob: Record<string, any>

  beforeEach(() => {
    blob = {
      apiKeys: {
        claude: { ...underKey(OLD, () => encryptCredential('sk-ant-old')), isValid: true, lastTested: '2026-10-01' },
        openai: { ...legacyCbc('sk-openai-cbc', OLD), isValid: null },
        openclaw: {
          ...underKey(OLD, () => encryptCredential('wss://gateway.example')),
          isGateway: true,
          authToken: underKey(OLD, () => encryptCredential('gw-token')),
        },
        gemini: { encrypted: true }, // a flag, not a credential
      },
      modelPreferences: { claude: 'claude-opus-5-5' },
      agentModes: { claude: 'polling' },
    }
  })

  it('AWTD-1380: rewrites every credential — top-level triples AND the nested openclaw authToken — under the new key', () => {
    const plan = planMcpSettings(JSON.stringify(blob), rotating())

    expect(plan.outcome).toEqual({ rewritten: 4, skipped: 0, failed: 0, conflicts: 0 })
    expect(plan.problems).toEqual([])
    const next = JSON.parse(plan.next!)
    expect(readUnderNewOnly(next.apiKeys.claude)).toBe('sk-ant-old')
    expect(readUnderNewOnly(next.apiKeys.openai)).toBe('sk-openai-cbc')
    expect(readUnderNewOnly(next.apiKeys.openclaw)).toBe('wss://gateway.example')
    expect(readUnderNewOnly(next.apiKeys.openclaw.authToken)).toBe('gw-token')
  })

  it('upgrades legacy CBC to GCM while passing through', () => {
    const next = JSON.parse(planMcpSettings(JSON.stringify(blob), rotating()).next!)
    expect(next.apiKeys.openai.authTag).toMatch(/^[0-9a-f]{32}$/)
  })

  it('carries every non-credential field through unchanged', () => {
    const next = JSON.parse(planMcpSettings(JSON.stringify(blob), rotating()).next!)
    expect(next.modelPreferences).toEqual(blob.modelPreferences)
    expect(next.agentModes).toEqual(blob.agentModes)
    expect(next.apiKeys.gemini).toEqual({ encrypted: true })
    expect(next.apiKeys.claude).toMatchObject({ isValid: true, lastTested: '2026-10-01' })
    expect(next.apiKeys.openclaw.isGateway).toBe(true)
  })

  it('verify fails before the rewrite and passes after it', () => {
    const before = planMcpSettings(JSON.stringify(blob), verifying())
    expect(before.outcome.failed).toBe(4)
    expect(before.next).toBeUndefined() // verify never proposes a write it would make

    const rewritten = planMcpSettings(JSON.stringify(blob), rotating()).next!
    const after = planMcpSettings(rewritten, verifying())
    expect(after.outcome).toMatchObject({ failed: 0, rewritten: 4 })
  })

  it('verify fails a CBC value even when the current key decrypts it — CBC cannot prove its key', () => {
    const cbcUnderNew = JSON.stringify({ apiKeys: { openai: legacyCbc('sk-x', NEW) } })
    const plan = planMcpSettings(cbcUnderNew, verifying())
    expect(plan.outcome.failed).toBe(1)
    expect(plan.problems).toEqual(['apiKeys.openai: legacy CBC, not yet rewritten'])
  })

  it('REPORTS a credential no key decrypts and leaves it byte-for-byte, while still rewriting the others', () => {
    const lost = crypto.randomBytes(32).toString('hex')
    blob.apiKeys.claude = underKey(lost, () => encryptCredential('sk-lost'))
    const plan = planMcpSettings(JSON.stringify(blob), rotating())

    expect(plan.outcome).toMatchObject({ rewritten: 3, failed: 1 })
    expect(plan.problems).toEqual(['apiKeys.claude: undecryptable'])
    expect(JSON.parse(plan.next!).apiKeys.claude).toEqual(blob.apiKeys.claude)
  })

  it('names WHERE a failure is and never what the value is', () => {
    blob.apiKeys.openclaw.authToken = { encrypted: 'deadbeef', iv: '00'.repeat(16), authTag: '00'.repeat(16) }
    const plan = planMcpSettings(JSON.stringify(blob), rotating())
    expect(plan.problems).toEqual(['apiKeys.openclaw.authToken: undecryptable'])
    expect(plan.problems.join()).not.toMatch(/gateway|sk-/)
  })

  it('reports unparseable JSON as failed and proposes no write', () => {
    const plan = planMcpSettings('{not json', rotating())
    expect(plan.outcome.failed).toBe(1)
    expect(plan.next).toBeUndefined()
  })

  it('leaves null, empty, and blobs without credentials alone', () => {
    for (const value of [null, '', '{}', '{"modelPreferences":{}}', '"double-encoded"', '{"apiKeys":null}']) {
      const plan = planMcpSettings(value, rotating())
      expect(plan.next, String(value)).toBeUndefined()
      expect(plan.outcome, String(value)).toEqual({ rewritten: 0, skipped: 0, failed: 0, conflicts: 0 })
    }
  })

  it('is idempotent: a second pass rewrites again and still reads back the same plaintext', () => {
    const once = planMcpSettings(JSON.stringify(blob), rotating()).next!
    const twice = planMcpSettings(once, rotating())
    expect(twice.outcome).toMatchObject({ rewritten: 4, failed: 0 })
    expect(readUnderNewOnly(JSON.parse(twice.next!).apiKeys.openclaw.authToken)).toBe('gw-token')
  })
})

describe('decryptCredentialStrict (AWTD-1380)', () => {
  it('GCM: the key whose auth tag verifies wins, whichever position it holds on the ring', () => {
    const triple = underKey(OLD, () => encryptCredential('sk-1'))
    expect(decryptCredentialStrict(triple, [NEW, OLD])).toEqual({ plaintext: 'sk-1', legacy: false })
    expect(decryptCredentialStrict(triple, [NEW])).toEqual({ failure: 'undecryptable' })
  })

  it('CBC: one decrypting key is an answer, flagged legacy', () => {
    expect(decryptCredentialStrict(legacyCbc('sk-2', OLD), [NEW, OLD])).toEqual({
      plaintext: 'sk-2',
      legacy: true,
    })
  })

  it('CBC: two keys both yielding valid UTF-8 is AMBIGUOUS — never a guess', () => {
    // Construct the collision directly: the same ciphertext bytes "decrypt"
    // under both keys whenever both happen to give valid padding and UTF-8.
    // Searching for a natural one is slow, so use the same key twice — the
    // property is about counting candidates, not about which bytes collide.
    expect(decryptCredentialStrict(legacyCbc('sk-3', OLD), [OLD, OLD])).toEqual({ failure: 'ambiguous' })
  })

  it('CBC: wrong-key output that is not valid UTF-8 is rejected rather than returned as mojibake', () => {
    // Find a ciphertext whose wrong-key decrypt passes padding but not UTF-8.
    let found = false
    for (let i = 0; i < 4000 && !found; i++) {
      const triple = legacyCbc(`sk-${i}`, OLD)
      const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(NEW, 'hex'), Buffer.from(triple.iv, 'hex'))
      try {
        const bytes = Buffer.concat([decipher.update(triple.encrypted, 'hex'), decipher.final()])
        if (bytes.toString('utf8').includes('�')) {
          expect(decryptCredentialStrict(triple, [NEW])).toEqual({ failure: 'undecryptable' })
          found = true
        }
      } catch {
        // bad padding — the common case
      }
    }
    expect(found).toBe(true)
  })
})
