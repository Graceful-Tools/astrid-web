import crypto from 'crypto'

/**
 * Authenticated encryption for AI service credentials stored inside the
 * user.mcpSettings JSON blob as { encrypted, iv, authTag } triples.
 *
 * Previously both app/api/user/ai-api-keys and
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

function key(): Buffer {
  const k = process.env.ENCRYPTION_KEY
  if (!k) throw new Error('ENCRYPTION_KEY environment variable is required')
  return Buffer.from(k, 'hex')
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
  if (data.authTag) {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv)
    decipher.setAuthTag(Buffer.from(data.authTag, 'hex'))
    let decrypted = decipher.update(data.encrypted, 'hex', 'utf8')
    decrypted += decipher.final('utf8')
    return decrypted
  }
  const decipher = crypto.createDecipheriv('aes-256-cbc', key(), iv)
  let decrypted = decipher.update(data.encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}
