/**
 * Opt-in scope enforcement for newly scoped access tokens (AWTD-1567).
 *
 * Access tokens (MCPToken rows) are granted `*`. A token minted with an
 * explicit scope records it in `MCPToken.scope` (space-separated OAuth scopes);
 * the column is null on every token that existed before, and only the mint path
 * writes it, so "created after the cutover with an explicit scope" is exactly
 * "scope is not null". Those tokens, and only those, are held to their scopes —
 * when this flag says so:
 *
 *   ASTRID_TOKEN_SCOPE_ENFORCEMENT=off (or unset, or anything else) — nobody
 *   ASTRID_TOKEN_SCOPE_ENFORCEMENT=canary — owners listed (comma-separated user
 *     ids) in ASTRID_TOKEN_SCOPE_ENFORCEMENT_USERS
 *   ASTRID_TOKEN_SCOPE_ENFORCEMENT=on — every explicitly scoped token
 *
 * Rollback is the flag: set it off and every token is back on `*`. Unscoped
 * tokens are never affected, whatever the flag says (Jon, 2026-11-26).
 */

import { formatScopeString, parseScopeString } from '@/lib/oauth/oauth-scopes'

export type TokenScopeEnforcementMode = 'off' | 'canary' | 'on'

export function tokenScopeEnforcementMode(): TokenScopeEnforcementMode {
  const value = process.env.ASTRID_TOKEN_SCOPE_ENFORCEMENT
  return value === 'on' || value === 'canary' ? value : 'off'
}

/** Is a scoped token owned by this user held to its scopes right now? */
export function tokenScopeEnforced(ownerId: string): boolean {
  const mode = tokenScopeEnforcementMode()
  if (mode === 'on') return true
  if (mode !== 'canary') return false
  return (process.env.ASTRID_TOKEN_SCOPE_ENFORCEMENT_USERS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean)
    .includes(ownerId)
}

/**
 * The scopes a token was minted with, or null for an unscoped token. Unknown
 * names and `*` are dropped (the mint path refuses them, so this only guards a
 * hand-edited row); a column that leaves nothing behind reads as unscoped
 * rather than as a token that can do nothing.
 */
export function explicitTokenScopes(column: string | null | undefined): string[] | null {
  if (!column) return null
  const scopes = parseScopeString(column).filter(scope => scope !== '*')
  return scopes.length > 0 ? [...new Set(scopes)] : null
}

/** How the mint path stores a validated scope list. */
export function tokenScopeColumn(scopes: readonly string[] | undefined): string | null {
  return scopes && scopes.length > 0 ? formatScopeString([...new Set(scopes)]) : null
}
