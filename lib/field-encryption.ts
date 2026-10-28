/**
 * Field-level encryption for sensitive data at rest
 * Uses AES-256-GCM for authenticated encryption
 */
import crypto from 'crypto'
import { currentEncryptionKeyHex, tryEachKey } from '@/lib/encryption-keys'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16
const ENCRYPTED_PREFIX = 'enc:v1:'

/**
 * The key new values are written under — ENCRYPTION_KEY_NEXT once a rotation is
 * in flight, otherwise ENCRYPTION_KEY. Reads go through the whole keyring
 * instead; see lib/encryption-keys.ts (task AWTD-1369).
 */
function getEncryptionKey(): Buffer {
  return Buffer.from(currentEncryptionKeyHex(), 'hex')
}

/**
 * Check if a value is encrypted (has our prefix)
 */
export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(ENCRYPTED_PREFIX)
}

/**
 * Encrypt a field value
 * Returns a prefixed string: enc:v1:<iv>:<authTag>:<ciphertext>
 */
export function encryptField(plaintext: string): string {
  if (!plaintext) return plaintext

  const key = getEncryptionKey()
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)

  let encrypted = cipher.update(plaintext, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const authTag = cipher.getAuthTag()

  // Format: enc:v1:<iv>:<authTag>:<encrypted>
  return `${ENCRYPTED_PREFIX}${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`
}

/**
 * Decrypt a field value
 * Handles both encrypted (prefixed) and plaintext values for backwards compatibility
 */
export function decryptField(value: string | null | undefined): string | null {
  if (!value) return null

  // If not encrypted, return as-is (backwards compatibility)
  if (!isEncrypted(value)) {
    return value
  }

  // Parse the encrypted format: enc:v1:<iv>:<authTag>:<ciphertext>
  const parts = value.slice(ENCRYPTED_PREFIX.length).split(':')
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted field format')
  }

  // Mid-rotation a stored value may be under either key, so try each. GCM's
  // auth tag makes this unambiguous: the wrong key throws rather than
  // returning plausible garbage.
  return tryEachKey(process.env, keyHex => decryptFieldWithKey(value, keyHex))
}

/**
 * Decrypt an `enc:v1:` value under one specific key. Throws when that key did
 * not encrypt it (the GCM auth tag fails). decryptField tries the whole ring;
 * this exists for the encryption census, which needs to know WHICH key works
 * (task AWTD-1369).
 */
export function decryptFieldWithKey(value: string, keyHex: string): string {
  const parts = value.slice(ENCRYPTED_PREFIX.length).split(':')
  if (!value.startsWith(ENCRYPTED_PREFIX) || parts.length !== 3) {
    throw new Error('Invalid encrypted field format')
  }

  const [ivHex, authTagHex, ciphertext] = parts
  const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(keyHex, 'hex'), Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'))
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

/**
 * Strict decrypt for columns that are ALWAYS written through encryptField
 * (e.g. sync-provider Integration tokens). Unlike decryptField, a non-null
 * value that lacks the enc:v1: prefix is a bug — a write site forgot to
 * encrypt — so this throws instead of silently returning plaintext, which
 * would otherwise persist an unencrypted secret forever undetected.
 * Use ONLY on columns with a guaranteed-encrypted invariant.
 */
export function decryptFieldStrict(value: string | null | undefined): string | null {
  if (value == null || value === '') return null
  if (!isEncrypted(value)) {
    throw new Error('decryptFieldStrict: value is not encrypted (a write site skipped encryptField)')
  }
  return decryptField(value)
}

/**
 * Encrypt an object's specified fields
 * Returns a new object with encrypted fields
 */
export function encryptFields<T extends Record<string, any>>(
  obj: T,
  fieldNames: (keyof T)[]
): T {
  const result = { ...obj }

  for (const field of fieldNames) {
    const value = obj[field]
    if (typeof value === 'string' && value && !isEncrypted(value)) {
      (result as any)[field] = encryptField(value)
    }
  }

  return result
}

/**
 * Decrypt an object's specified fields
 * Returns a new object with decrypted fields
 */
export function decryptFields<T extends Record<string, any>>(
  obj: T,
  fieldNames: (keyof T)[]
): T {
  const result = { ...obj }

  for (const field of fieldNames) {
    const value = obj[field]
    if (typeof value === 'string') {
      (result as any)[field] = decryptField(value)
    }
  }

  return result
}

/**
 * Encrypt contact-specific fields
 * Used for AddressBookContact model
 */
export function encryptContactFields(contact: {
  email?: string | null
  name?: string | null
  phoneNumber?: string | null
}): typeof contact {
  return {
    ...contact,
    email: contact.email && !isEncrypted(contact.email) ? encryptField(contact.email) : contact.email,
    name: contact.name && !isEncrypted(contact.name) ? encryptField(contact.name) : contact.name,
    phoneNumber: contact.phoneNumber && !isEncrypted(contact.phoneNumber) ? encryptField(contact.phoneNumber) : contact.phoneNumber,
  }
}

/**
 * Decrypt contact-specific fields
 * Used for AddressBookContact model
 */
export function decryptContactFields<T extends {
  email?: string | null
  name?: string | null
  phoneNumber?: string | null
}>(contact: T): T {
  return {
    ...contact,
    email: decryptField(contact.email),
    name: decryptField(contact.name),
    phoneNumber: decryptField(contact.phoneNumber),
  }
}

/**
 * Encrypt GitHub integration sensitive fields
 */
export function encryptGitHubFields(integration: {
  privateKey?: string | null
  webhookSecret?: string | null
}): typeof integration {
  return {
    ...integration,
    privateKey: integration.privateKey && !isEncrypted(integration.privateKey)
      ? encryptField(integration.privateKey)
      : integration.privateKey,
    webhookSecret: integration.webhookSecret && !isEncrypted(integration.webhookSecret)
      ? encryptField(integration.webhookSecret)
      : integration.webhookSecret,
  }
}

/**
 * Decrypt GitHub integration sensitive fields
 */
export function decryptGitHubFields<T extends {
  privateKey?: string | null
  webhookSecret?: string | null
}>(integration: T): T {
  return {
    ...integration,
    privateKey: decryptField(integration.privateKey),
    webhookSecret: decryptField(integration.webhookSecret),
  }
}

/**
 * Encrypt push subscription sensitive fields
 */
export function encryptPushSubscriptionFields(subscription: {
  p256dh: string
  auth: string
}): { p256dh: string; auth: string } {
  return {
    p256dh: encryptField(subscription.p256dh),
    auth: encryptField(subscription.auth),
  }
}

/**
 * Decrypt push subscription sensitive fields
 */
export function decryptPushSubscriptionFields<T extends {
  p256dh: string
  auth: string
}>(subscription: T): T {
  return {
    ...subscription,
    p256dh: decryptField(subscription.p256dh) || '',
    auth: decryptField(subscription.auth) || '',
  }
}
