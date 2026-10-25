/**
 * What the re-encryption pass walks, and how it decides a row is done.
 *
 * Separated from the script so the plan is testable without a database
 * (task AWTD-1369). scripts/reencrypt-fields.ts executes it.
 *
 * Every column here is written through lib/field-encryption.ts, so each value
 * is either plaintext (legacy, left alone) or `enc:v1:<iv>:<authTag>:<ct>`.
 * The format does NOT record which key encrypted it — deliberately: adding a
 * key id would mean a schema-visible migration, and GCM's auth tag already
 * identifies the right key unambiguously by failing on the wrong one.
 *
 * So "has this row been migrated?" cannot be answered by looking at it. The
 * pass instead decrypts with the whole keyring and rewrites under the current
 * key, which is idempotent: re-running it on an already-migrated row produces
 * a fresh IV and the same plaintext, costing a write but never corrupting.
 * Completion is proved separately by `--verify`, which decrypts with the
 * current key ALONE and counts failures; zero means nothing is left under the
 * old key.
 */

/** A table and the encrypted columns on it. */
export interface EncryptedColumns {
  /** Prisma model accessor, e.g. `addressBookContact`. */
  model: string
  /** Human name for logs. */
  table: string
  columns: string[]
  /** Column to order and page by — must be unique and stable. */
  cursor: string
}

/**
 * Every column holding a field-encryption value.
 *
 * NOT covered, and each needs its own walker before a rotation can finish:
 *   - AI credentials in `User.mcpSettings` (a JSON blob of
 *     { encrypted, iv, authTag } triples via lib/ai/credential-cipher.ts)
 *   - the legacy CryptoJS and raw-CBC values read by lib/api-key-cache.ts
 * Both now decrypt under either key, so they do not block the rotation's
 * *start* — only its finish, when the old key is dropped.
 */
export const ENCRYPTED_COLUMNS: EncryptedColumns[] = [
  {
    model: 'addressBookContact',
    table: 'AddressBookContact',
    columns: ['name', 'phoneNumber'],
    cursor: 'id',
  },
  {
    model: 'userWebhookConfig',
    table: 'UserWebhookConfig',
    columns: ['webhookUrl', 'webhookSecret'],
    cursor: 'id',
  },
  {
    model: 'pushSubscription',
    table: 'PushSubscription',
    columns: ['p256dh', 'auth'],
    cursor: 'id',
  },
]

export interface RowOutcome {
  /** Values rewritten under the current key. */
  rewritten: number
  /** Plaintext or empty values left exactly as they were. */
  skipped: number
  /** Values no key could decrypt — the pass must NOT write these. */
  failed: number
}

export function emptyOutcome(): RowOutcome {
  return { rewritten: 0, skipped: 0, failed: 0 }
}

export function addOutcome(a: RowOutcome, b: RowOutcome): RowOutcome {
  return {
    rewritten: a.rewritten + b.rewritten,
    skipped: a.skipped + b.skipped,
    failed: a.failed + b.failed,
  }
}

/**
 * Decide the new value for one column.
 *
 * Returns `undefined` when the column should be left alone, which keeps the
 * caller from writing a column it did not change.
 *
 * A value that no key decrypts is reported, never rewritten: rewriting would
 * require inventing a plaintext, and the honest outcome is to leave it and let
 * `failed > 0` stop the rotation.
 */
export function planColumn(
  value: unknown,
  deps: {
    isEncrypted: (v: string) => boolean
    decrypt: (v: string) => string | null
    encrypt: (v: string) => string
  },
): { next: string } | { skip: true } | { failed: true } {
  if (typeof value !== 'string' || value === '') return { skip: true }
  // Plaintext predates encryption at this column and is not ours to change —
  // decryptField passes it through, so re-encrypting it here would silently
  // alter what the app reads back.
  if (!deps.isEncrypted(value)) return { skip: true }

  let plaintext: string | null
  try {
    plaintext = deps.decrypt(value)
  } catch {
    return { failed: true }
  }
  if (plaintext === null) return { failed: true }

  return { next: deps.encrypt(plaintext) }
}
