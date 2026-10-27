/**
 * RED for task AWTD-1369 (rotate ENCRYPTION_KEY).
 *
 * Production's `ENCRYPTION_KEY` is a Vercel **Secret**, so its value cannot be
 * read back. That rules out the usual rotation shape — `ENCRYPTION_KEY` = new
 * plus `ENCRYPTION_KEY_PREVIOUS` = old — because setting up the second variable
 * means writing the old value, which means reading it first.
 *
 * So the keyring is inverted: `ENCRYPTION_KEY` stays exactly as it is (nobody
 * needs to know it; production has it injected) and `ENCRYPTION_KEY_NEXT`
 * carries the new key. Decryption tries every key it holds; encryption uses the
 * current one, which is NEXT once NEXT is set. When the re-encryption pass has
 * rewritten everything, `ENCRYPTION_KEY` is set to the new value — which a
 * human does know — and NEXT is dropped.
 *
 * Trying both keys on decrypt is safe because every format here is
 * authenticated (AES-256-GCM): a wrong key fails the auth tag rather than
 * returning plausible garbage. The one exception is legacy AES-256-CBC, which
 * is unauthenticated — see the note on `tryEachKey`.
 */
import { describe, it, expect } from 'vitest'
import {
  currentEncryptionKeyHex,
  encryptionKeyHexes,
  tryEachKey,
} from '@/lib/encryption-keys'

const OLD = 'a'.repeat(64)
const NEW = 'b'.repeat(64)

describe('encryption keyring (AWTD-1369)', () => {
  describe('before a rotation starts — only ENCRYPTION_KEY is set', () => {
    const env = { ENCRYPTION_KEY: OLD }

    it('encrypts with ENCRYPTION_KEY', () => {
      expect(currentEncryptionKeyHex(env)).toBe(OLD)
    })

    it('has exactly one key to try on decrypt', () => {
      expect(encryptionKeyHexes(env)).toEqual([OLD])
    })
  })

  describe('mid-rotation — ENCRYPTION_KEY_NEXT is set too', () => {
    const env = { ENCRYPTION_KEY: OLD, ENCRYPTION_KEY_NEXT: NEW }

    it('encrypts with NEXT, so new writes land under the new key', () => {
      expect(currentEncryptionKeyHex(env)).toBe(NEW)
    })

    it('tries the current key FIRST, then the old one', () => {
      // Order matters for cost, not correctness: once the pass has run, most
      // rows are under NEXT, so trying it first avoids a failed decrypt per row.
      expect(encryptionKeyHexes(env)).toEqual([NEW, OLD])
    })
  })

  describe('after the rotation — NEXT has been folded into ENCRYPTION_KEY', () => {
    const env = { ENCRYPTION_KEY: NEW }

    it('is back to a single key, with no trace of the old one', () => {
      expect(currentEncryptionKeyHex(env)).toBe(NEW)
      expect(encryptionKeyHexes(env)).toEqual([NEW])
    })
  })

  describe('rejects what cannot be a key, rather than failing at cipher time', () => {
    it('throws when no key is configured at all', () => {
      expect(() => currentEncryptionKeyHex({})).toThrow(/ENCRYPTION_KEY/)
    })

    it('ignores an empty or whitespace NEXT instead of encrypting under it', () => {
      // An env var that exists but is blank is a half-finished setup, not a key.
      expect(currentEncryptionKeyHex({ ENCRYPTION_KEY: OLD, ENCRYPTION_KEY_NEXT: '' })).toBe(OLD)
      expect(currentEncryptionKeyHex({ ENCRYPTION_KEY: OLD, ENCRYPTION_KEY_NEXT: '   ' })).toBe(OLD)
    })

    it('rejects the [SENSITIVE] placeholder vercel pull writes for a Secret', () => {
      // The exact failure that broke two production deploys on 2026-10-25:
      // a non-empty, truthy placeholder. It is not 64 hex chars, so it is not a key.
      expect(() => currentEncryptionKeyHex({ ENCRYPTION_KEY: '[SENSITIVE]' })).toThrow(/hex/i)
    })

    it('rejects a key of the wrong length — aes-256 needs 32 bytes', () => {
      expect(() => currentEncryptionKeyHex({ ENCRYPTION_KEY: 'abcdef' })).toThrow(/hex/i)
    })

    it('rejects a NEXT identical to ENCRYPTION_KEY — that is not a rotation', () => {
      expect(() => encryptionKeyHexes({ ENCRYPTION_KEY: OLD, ENCRYPTION_KEY_NEXT: OLD })).toThrow(
        /same/i,
      )
    })
  })

  describe('tryEachKey', () => {
    it('returns the first key that works', () => {
      const result = tryEachKey({ ENCRYPTION_KEY: OLD, ENCRYPTION_KEY_NEXT: NEW }, hex => {
        if (hex !== OLD) throw new Error('auth tag mismatch')
        return 'plaintext'
      })
      expect(result).toBe('plaintext')
    })

    it('rethrows the LAST failure when no key works, so the error is a real one', () => {
      expect(() =>
        tryEachKey({ ENCRYPTION_KEY: OLD, ENCRYPTION_KEY_NEXT: NEW }, () => {
          throw new Error('auth tag mismatch')
        }),
      ).toThrow(/auth tag mismatch/)
    })

    it('does not swallow a non-cipher bug — it still surfaces', () => {
      expect(() =>
        tryEachKey({ ENCRYPTION_KEY: OLD }, () => {
          throw new TypeError('reading property of undefined')
        }),
      ).toThrow(TypeError)
    })
  })
})
