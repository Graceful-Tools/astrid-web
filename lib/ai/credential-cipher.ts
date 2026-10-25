import crypto from 'crypto'
import { currentEncryptionKeyHex, tryEachKey } from '@/lib/encryption-keys'

/**
 * Authenticated encryption for AI service credentials stored inside the
 * user.mcpSettings JSON blob as { encrypted, iv, authTag } triples.
 *
 * Previously both app/api/v1/users/me/ai-credentials and
 * app/api/v1/users/me/ai-credentials hand-rolled *identical* AES-256-CBC —
 * which is unauthenticated (malleable, no tamper detection) and duplicated.
 * This is the single shared implementation: it WRITES AES-256-GCM (with an
 * auth tag) and READS both GCM (authTag present) and legacy CBC (authTag
 * absent) so existing stored keys keep decrypting.
 */

const IV_LENGTH = 16

export interface EncryptedCredential {
  encrypted: string
  iv: string
  /** Present for GCM (authenticated). Absent ⇒ legacy CBC. */
  authTag?: string
}

/** The key new credentials are written under (AWTD-1369). */
function key(): Buffer {
  return Buffer.from(currentEncryptionKeyHex(), 'hex')
}

/** Encrypt with AES-256-GCM. Always emits an authTag. */
export function encryptCredential(text: string): EncryptedCredential {
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv)
  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag: cipher.getAuthTag().toString('hex'),
  }
}

/**
 * Decrypt. GCM when authTag is present (verifies the tag → throws on
 * tampering); falls back to CBC for legacy rows written before this change.
 */
export function decryptCredential(data: EncryptedCredential): string {
  const iv = Buffer.from(data.iv, 'hex')

  // Mid-rotation a credential may be under either key (AWTD-1369). GCM
  // verifies, so a wrong key throws. Legacy CBC does NOT, so a wrong key there
  // yields a padding error or mojibake rather than a clean failure — these are
  // read-only legacy rows and callers treat a failure as "no credential", so
  // the worst case is a credential reading as absent, not as wrong.
  return tryEachKey(process.env, keyHex => {
    const k = Buffer.from(keyHex, 'hex')
    if (data.authTag) {
      const decipher = crypto.createDecipheriv('aes-256-gcm', k, iv)
      decipher.setAuthTag(Buffer.from(data.authTag, 'hex'))
      let decrypted = decipher.update(data.encrypted, 'hex', 'utf8')
      decrypted += decipher.final('utf8')
      return decrypted
    }
    const decipher = crypto.createDecipheriv('aes-256-cbc', k, iv)
    let decrypted = decipher.update(data.encrypted, 'hex', 'utf8')
    decrypted += decipher.final('utf8')
    return decrypted
  })
}
