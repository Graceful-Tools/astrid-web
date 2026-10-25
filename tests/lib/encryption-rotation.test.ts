/**
 * RED for task AWTD-1369: a value written under the old key must stay readable
 * while the new key is being phased in.
 *
 * This is the property the whole rotation rests on. Without it, setting
 * `ENCRYPTION_KEY_NEXT` instantly makes every stored contact name, webhook
 * secret, push subscription and AI credential unreadable — which is exactly the
 * data loss this task exists to avoid.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

const OLD = 'a1'.repeat(32)
const NEW = 'b2'.repeat(32)

let saved: { key?: string; next?: string }

function setEnv(key?: string, next?: string) {
  if (key === undefined) delete process.env.ENCRYPTION_KEY
  else process.env.ENCRYPTION_KEY = key
  if (next === undefined) delete process.env.ENCRYPTION_KEY_NEXT
  else process.env.ENCRYPTION_KEY_NEXT = next
}

beforeEach(() => {
  saved = { key: process.env.ENCRYPTION_KEY, next: process.env.ENCRYPTION_KEY_NEXT }
})
afterEach(() => {
  setEnv(saved.key, saved.next)
})

describe('field-encryption across a rotation (AWTD-1369)', () => {
  it('reads an old-key value after ENCRYPTION_KEY_NEXT is introduced', async () => {
    const fe = await import('@/lib/field-encryption')

    setEnv(OLD)
    const stored = fe.encryptField('Ada Lovelace')
    expect(fe.isEncrypted(stored)).toBe(true)

    // Rotation begins. Nothing has been re-encrypted yet.
    setEnv(OLD, NEW)
    expect(fe.decryptField(stored)).toBe('Ada Lovelace')
  })

  it('writes new values under NEXT, so the pass has something to converge on', async () => {
    const fe = await import('@/lib/field-encryption')

    setEnv(OLD, NEW)
    const stored = fe.encryptField('+44 7700 900000')

    // Readable with only the new key — i.e. it was written under NEXT, not OLD.
    setEnv(NEW)
    expect(fe.decryptField(stored)).toBe('+44 7700 900000')
  })

  it('an old-key value stops being readable once NEXT is folded in — hence the pass', async () => {
    const fe = await import('@/lib/field-encryption')

    setEnv(OLD)
    const stored = fe.encryptField('secret')

    // Dropping the old key before re-encrypting is the data-loss scenario.
    setEnv(NEW)
    expect(() => fe.decryptField(stored)).toThrow()
  })

  it('round-trips under a single key, unchanged from before the keyring', async () => {
    const fe = await import('@/lib/field-encryption')
    setEnv(OLD)
    expect(fe.decryptField(fe.encryptField('unchanged'))).toBe('unchanged')
  })

  it('still passes plaintext through untouched for backwards compatibility', async () => {
    const fe = await import('@/lib/field-encryption')
    setEnv(OLD, NEW)
    expect(fe.decryptField('not-encrypted-at-all')).toBe('not-encrypted-at-all')
  })
})

describe('ai credential cipher across a rotation (AWTD-1369)', () => {
  it('reads an old-key credential after NEXT is introduced', async () => {
    const cc = await import('@/lib/ai/credential-cipher')

    setEnv(OLD)
    const stored = cc.encryptCredential('sk-ant-example')

    setEnv(OLD, NEW)
    expect(cc.decryptCredential(stored)).toBe('sk-ant-example')
  })

  it('writes new credentials under NEXT', async () => {
    const cc = await import('@/lib/ai/credential-cipher')

    setEnv(OLD, NEW)
    const stored = cc.encryptCredential('sk-ant-example')

    setEnv(NEW)
    expect(cc.decryptCredential(stored)).toBe('sk-ant-example')
  })
})
