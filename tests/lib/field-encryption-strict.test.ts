import { describe, it, expect, beforeAll } from 'vitest'
import crypto from 'crypto'
import { encryptField, decryptFieldStrict, decryptField } from '@/lib/field-encryption'

beforeAll(() => {
  process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex')
})

describe('decryptFieldStrict', () => {
  it('round-trips a properly encrypted value', () => {
    expect(decryptFieldStrict(encryptField('gho_token'))).toBe('gho_token')
  })

  it('throws on a non-encrypted value (a forgotten encryptField at the write site)', () => {
    // decryptField would silently return this plaintext, persisting an
    // unencrypted secret forever. Strict surfaces the bug instead.
    expect(() => decryptFieldStrict('gho_plaintext_leak')).toThrow()
    expect(decryptField('gho_plaintext_leak')).toBe('gho_plaintext_leak') // documents the lenient behavior it guards against
  })

  it('treats null/empty as null, not an error', () => {
    expect(decryptFieldStrict(null)).toBeNull()
    expect(decryptFieldStrict(undefined)).toBeNull()
    expect(decryptFieldStrict('')).toBeNull()
  })
})
