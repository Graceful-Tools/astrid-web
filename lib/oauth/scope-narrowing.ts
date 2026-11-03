/**
 * Re-issued tokens follow the connection's CURRENT permissions (AWTD-1521).
 *
 * Settings → Connections can untick a single permission (AWTD-1513). That
 * edits `OAuthClient.scopes`, but a refresh token or an unused authorization
 * code still carries the scopes it was minted with, and both re-issue those
 * verbatim, so a removal only reached connections that signed in again.
 *
 * Jon chose option A: limit every re-issued token to what its app holds now.
 * The risk is a connector whose live token holds a scope its app's list never
 * had (tokens predating the issuance checks), which would lose it on refresh.
 * There is no read path to production data from an agent's machine, so the
 * check is built in, the same way history retention was rolled out:
 *
 *   - unset (the default): DRY RUN. Log what would be dropped, issue the old
 *     scopes unchanged.
 *   - `OAUTH_SCOPE_NARROWING=enforce`: issue only the scopes the app still has.
 *
 * An app holding the wildcard keeps everything its tokens carried, so this can
 * never strip a legitimately wildcard-backed token.
 */
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'

const log = createLogger('oauth.scope-narrowing')

const WILDCARD = '*'

export const OAUTH_SCOPE_NARROWING_ENV = 'OAUTH_SCOPE_NARROWING'

export type ScopeNarrowingMode = 'enforce' | 'dry-run'

/** Exactly `enforce` narrows; anything else (unset included) only logs. */
export function scopeNarrowingMode(
  env: Record<string, string | undefined> = process.env,
): ScopeNarrowingMode {
  return env[OAUTH_SCOPE_NARROWING_ENV] === 'enforce' ? 'enforce' : 'dry-run'
}

/** Split a token's scopes into those its app still holds and those it no longer does. */
export function narrowToClientScopes(
  tokenScopes: string[],
  clientScopes: string[],
): { kept: string[]; dropped: string[] } {
  if (clientScopes.includes(WILDCARD)) return { kept: [...tokenScopes], dropped: [] }
  const held = new Set(clientScopes)
  return {
    kept: tokenScopes.filter(scope => held.has(scope)),
    dropped: tokenScopes.filter(scope => !held.has(scope)),
  }
}

/**
 * The scopes to put on a token re-issued from a refresh token or an
 * authorization code. `clientId` is the OAuthClient row id.
 */
export async function scopesForReissue(
  clientId: string,
  tokenScopes: string[],
  source: 'refresh_token' | 'authorization_code',
  env: Record<string, string | undefined> = process.env,
): Promise<string[]> {
  const client = await prisma.oAuthClient.findUnique({
    where: { id: clientId },
    select: { scopes: true },
  })
  // The caller already matched a token row to this client; a vanished client
  // is not this function's failure to report.
  if (!client) return tokenScopes

  const { kept, dropped } = narrowToClientScopes(tokenScopes, client.scopes)
  if (dropped.length === 0) return tokenScopes

  const mode = scopeNarrowingMode(env)
  log.info(
    { clientId, source, mode, dropped, kept },
    mode === 'enforce'
      ? 'OAuth scope narrowing dropped scopes the app no longer holds'
      : `OAuth scope narrowing DRY RUN, would drop scopes (set ${OAUTH_SCOPE_NARROWING_ENV}=enforce to apply)`,
  )
  return mode === 'enforce' ? kept : tokenScopes
}
