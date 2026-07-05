import { describe, it, expect, beforeAll } from 'vitest'
import crypto from 'crypto'
import { encryptCredential, decryptCredential } from '@/lib/ai/credential-cipher'

beforeAll(() => {
  process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex')
})

describe('credential-cipher', () => {
  it('GCM round-trips', () => {
    const c = encryptCredential('sk-secret-123')
    expect(c.authTag).toBeTruthy()
    expect(c.encrypted).not.toContain('sk-secret')
    expect(decryptCredential(c)).toBe('sk-secret-123')
  })

  it('detects tampering (the point of authenticated encryption)', () => {
    const c = encryptCredential('sk-secret-123')
    // Flip a byte of ciphertext — GCM auth tag verification must reject it,
    // whereas the old CBC silently returned garbage/attacker-chosen plaintext.
    const tampered = { ...c, encrypted: (parseInt(c.encrypted.slice(0, 2), 16) ^ 1).toString(16).padStart(2, '0') + c.encrypted.slice(2) }
    expect(() => decryptCredential(tampered)).toThrow()
  })

  it('still decrypts legacy CBC rows (no authTag)', () => {
    // Simulate a value written by the old hand-rolled CBC path.
    const iv = crypto.randomBytes(16)
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(process.env.ENCRYPTION_KEY!, 'hex'), iv)
    let enc = cipher.update('legacy-key', 'utf8', 'hex'); enc += cipher.final('hex')
    expect(decryptCredential({ encrypted: enc, iv: iv.toString('hex') })).toBe('legacy-key')
  })
})
