import crypto from 'crypto'
import { encryptField, decryptField } from '@/lib/field-encryption'

/**
 * MCP tokens are stored HASHED (the `token` column = SHA-256, the lookup key)
 * so a DB/backup leak can't expose usable bearer credentials — plus an
 * AES-256-GCM copy (`tokenEncrypted`) because several server-to-server callers
 * (mobile-token reuse, agent webhooks) need the plaintext back after storage.
 *
 * Tokens are 32+ random bytes, so an unsalted SHA-256 is adequate for lookup.
 */
export function hashMCPToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/** Fields to persist for a freshly-generated plaintext MCP token. */
export function mcpTokenStorageFields(plaintext: string): { token: string; tokenEncrypted: string } {
  return { token: hashMCPToken(plaintext), tokenEncrypted: encryptField(plaintext) }
}

/**
 * Recover the plaintext for a stored row (return/reuse path). Prefers the
 * encrypted copy; falls back to the `token` column for legacy rows not yet
 * backfilled (still plaintext there).
 */
export function resolveMCPPlaintext(row: { token: string; tokenEncrypted?: string | null }): string | null {
  if (row.tokenEncrypted) return decryptField(row.tokenEncrypted)
  // Pre-backfill row: `token` is still the plaintext (starts with astrid_mcp_).
  return row.token.startsWith('astrid_') ? row.token : null
}

/**
 * Dual-read lookup filter: matches a hashed row, or a legacy plaintext row.
 *
 * The plaintext branch is guarded by the credential prefix, and that guard is
 * the security property (task 0845cf1c). Without it the filter also matched the
 * STORED value verbatim, so anyone who could read the table — a backup, a
 * support export, a log line — could present the stored hash as the bearer and
 * be authenticated, which is precisely the threat hashing was added to stop.
 *
 * Real tokens are `astrid_mcp_<64 hex>`; a stored hash is bare hex with no
 * prefix. Keeping the guard rather than deleting the branch means this is safe
 * whether or not scripts/migrate-hash-mcp-tokens.ts has finished in a given
 * environment.
 */
export function mcpTokenLookup(presented: string): string[] {
  const filters = [hashMCPToken(presented)]
  if (presented.startsWith('astrid_')) {
    filters.push(presented)
  }
  return filters
}
