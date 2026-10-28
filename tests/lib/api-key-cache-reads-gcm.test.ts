/**
 * Task AWTD-1380. `getCachedApiKey` read `mcpSettings.apiKeys[service]` with a
 * private CBC-only decrypt, but every key saved since 2026-07-05 has been
 * written by `encryptCredential` as GCM. So the assistant runtime, the
 * available-agents check and Copilot's pasted-token fallback all saw "no key"
 * for any credential a user had saved since then.
 *
 * The cache now reads through lib/ai/credential-cipher, the one cipher that
 * writes these triples. These tests pin both formats it must read.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import crypto from 'crypto'

const findUnique = vi.fn()
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique } } }))

const KEY = crypto.randomBytes(32).toString('hex')

function legacyCbc(plaintext: string, keyHex = KEY) {
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(keyHex, 'hex'), iv)
  let encrypted = cipher.update(plaintext, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  return { encrypted, iv: iv.toString('hex') }
}

async function load() {
  vi.resetModules()
  const cache = await import('@/lib/api-key-cache')
  const cipher = await import('@/lib/ai/credential-cipher')
  return { ...cache, ...cipher }
}

function storeApiKeys(apiKeys: Record<string, unknown>, asString = true) {
  const settings = { apiKeys, other: 'kept' }
  findUnique.mockResolvedValue({ mcpSettings: asString ? JSON.stringify(settings) : settings })
}

describe('getCachedApiKey reads what the credentials route writes (AWTD-1380)', () => {
  beforeEach(() => {
    findUnique.mockReset()
    process.env.ENCRYPTION_KEY = KEY
    delete process.env.ENCRYPTION_KEY_NEXT
  })

  it('AWTD-1380: decrypts a GCM credential written by encryptCredential', async () => {
    const { getCachedApiKey, encryptCredential } = await load()
    storeApiKeys({ claude: { ...encryptCredential('sk-ant-gcm'), isValid: null } })

    expect(await getCachedApiKey('user-gcm', 'claude')).toBe('sk-ant-gcm')
  })

  it('still decrypts a legacy CBC credential (no authTag)', async () => {
    const { getCachedApiKey } = await load()
    storeApiKeys({ openai: legacyCbc('sk-legacy-cbc') })

    expect(await getCachedApiKey('user-cbc', 'openai')).toBe('sk-legacy-cbc')
  })

  it('reads a GCM credential written under the old key mid-rotation', async () => {
    const { getCachedApiKey, encryptCredential } = await load()
    storeApiKeys({ gemini: encryptCredential('sk-old-key') }) // under KEY
    process.env.ENCRYPTION_KEY_NEXT = crypto.randomBytes(32).toString('hex')

    expect(await getCachedApiKey('user-rot', 'gemini')).toBe('sk-old-key')
  })

  it('answers null, not garbage, for a GCM credential no key on the ring decrypts', async () => {
    const { getCachedApiKey, encryptCredential } = await load()
    storeApiKeys({ claude: encryptCredential('sk-lost') })
    process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex')

    expect(await getCachedApiKey('user-lost', 'claude')).toBeNull()
  })
})
