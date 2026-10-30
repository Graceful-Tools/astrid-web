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
 * The one store that is NOT a column — AI credentials inside the
 * `User.mcpSettings` JSON blob — has its own planner, planMcpSettings, below.
 * lib/api-key-cache.ts reads that same blob through lib/ai/credential-cipher
 * (AWTD-1380), so there is no other credential store left to cover: its
 * CryptoJS-passphrase decrypt had no caller and was deleted.
 *
 * A column holding plaintext is skipped, so listing one whose writer
 * encrypts only some rows (GitHubIntegration) is safe.
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
  // OAuth grants for sync (lib/sync/*) and GitHub App user tokens
  // (lib/github/user-tokens.ts). Missing these would let --verify pass while
  // every connection broke the moment the old key was dropped.
  {
    model: 'integration',
    table: 'Integration',
    columns: ['accessToken', 'refreshToken'],
    cursor: 'id',
  },
  {
    model: 'copilotCredential',
    table: 'CopilotCredential',
    columns: ['accessToken', 'refreshToken'],
    cursor: 'id',
  },
  {
    model: 'gitHubIntegration',
    table: 'GitHubIntegration',
    columns: ['privateKey', 'webhookSecret'],
    cursor: 'id',
  },
  {
    model: 'mCPToken',
    table: 'MCPToken',
    columns: ['tokenEncrypted'],
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
  /**
   * Values not written because the row changed between read and write — the
   * app refreshed a token, say. Never overwritten (that would roll the token
   * back); a re-run picks them up, and --verify decides whether it must.
   */
  conflicts: number
}

export function emptyOutcome(): RowOutcome {
  return { rewritten: 0, skipped: 0, failed: 0, conflicts: 0 }
}

export function addOutcome(a: RowOutcome, b: RowOutcome): RowOutcome {
  return {
    rewritten: a.rewritten + b.rewritten,
    skipped: a.skipped + b.skipped,
    failed: a.failed + b.failed,
    conflicts: a.conflicts + b.conflicts,
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

/** The { encrypted, iv, authTag? } triple lib/ai/credential-cipher writes. */
export interface CredentialTriple {
  encrypted: string
  iv: string
  authTag?: string
}

export interface McpSettingsDeps {
  decrypt: (
    triple: CredentialTriple,
  ) => { plaintext: string; legacy: boolean } | { failure: 'undecryptable' | 'ambiguous' }
  encrypt: (plaintext: string) => CredentialTriple
  /**
   * --verify: an unauthenticated CBC value fails even when it decrypts, since
   * CBC cannot prove which key wrote it. A rewrite upgrades every one to GCM,
   * so after a clean rewrite none are left.
   */
  requireAuthenticated: boolean
}

export interface McpSettingsPlan {
  /** The new blob, or undefined when nothing in it changed. */
  next?: string
  outcome: RowOutcome
  /** Where each failure is (`apiKeys.openclaw.authToken: ambiguous`) — never a value. */
  problems: string[]
}

function isTriple(value: unknown): value is CredentialTriple & Record<string, unknown> {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  // Some entries use `encrypted: true` as a flag (lib/ai/user-config-schemas.ts);
  // only a string ciphertext with a string IV is a credential.
  return typeof v.encrypted === 'string' && v.encrypted !== '' && typeof v.iv === 'string'
}

/**
 * Plan the rewrite of one `User.mcpSettings` blob (AWTD-1380).
 *
 * Credentials live at `apiKeys[service]` as a triple spread onto an entry that
 * also carries metadata (isValid, lastTested…), and an openclaw gateway nests
 * a second, separately encrypted triple at `apiKeys.openclaw.authToken`. Both
 * are rewritten; everything else in the blob is carried through unchanged.
 *
 * Same contract as planColumn: a credential no key decrypts — or, for CBC,
 * more than one key does — is counted as failed and left exactly as stored,
 * while the blob's other credentials are still rewritten.
 */
export function planMcpSettings(value: unknown, deps: McpSettingsDeps): McpSettingsPlan {
  const outcome = emptyOutcome()
  const problems: string[] = []
  if (typeof value !== 'string' || value === '') return { outcome, problems }

  let settings: unknown
  try {
    settings = JSON.parse(value)
  } catch {
    // The app reads this as "no settings", so no credential in it is reachable
    // — but it is not ours to judge empty either. Report it, never rewrite it.
    outcome.failed++
    return { outcome, problems: ['mcpSettings: not valid JSON'] }
  }
  if (!settings || typeof settings !== 'object') return { outcome, problems }
  const apiKeys = (settings as Record<string, unknown>).apiKeys
  if (!apiKeys || typeof apiKeys !== 'object') return { outcome, problems }

  let changed = false
  const rewrite = (holder: Record<string, unknown>, key: string, path: string) => {
    const triple = holder[key]
    if (!isTriple(triple)) return
    const result = deps.decrypt({ encrypted: triple.encrypted, iv: triple.iv, authTag: triple.authTag })
    if ('failure' in result) {
      outcome.failed++
      problems.push(`${path}: ${result.failure}`)
      return
    }
    if (deps.requireAuthenticated && result.legacy) {
      outcome.failed++
      problems.push(`${path}: legacy CBC, not yet rewritten`)
      return
    }
    holder[key] = { ...triple, ...deps.encrypt(result.plaintext) }
    outcome.rewritten++
    changed = true
  }

  for (const service of Object.keys(apiKeys)) {
    rewrite(apiKeys as Record<string, unknown>, service, `apiKeys.${service}`)
    const entry = (apiKeys as Record<string, unknown>)[service]
    if (entry && typeof entry === 'object') {
      rewrite(entry as Record<string, unknown>, 'authToken', `apiKeys.${service}.authToken`)
    }
  }

  return { next: changed ? JSON.stringify(settings) : undefined, outcome, problems }
}
