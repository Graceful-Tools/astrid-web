/**
 * Bring an OAuth client's scopes up to date with the group it was provisioned
 * from (task 9ebfaba7).
 *
 * An OAuth client's scopes were frozen at creation, and most provisioning paths
 * never consulted `SCOPE_GROUPS` at all — `lib/astrid-api-client.ts` wrote the
 * same six-scope list three times. So adding a scope to a group reached almost
 * nothing, and bringing an existing connection up to date meant a hand-written
 * UPDATE against the production `OAuthClient` row. Jon, 2026-09-16: make it
 * standard for agent connections rather than a manual grant.
 *
 * What surfaced it: `chat:read`/`chat:write` gate the v1 chat routes but no
 * client-credentials token could carry them, so every one 403'd.
 *
 * THIS WIDENS PRIVILEGES. That is the entire risk, so the bounds are the
 * design rather than checks bolted onto it:
 *
 *   1. **No group, no change.** Every client that exists today is unmarked,
 *      and none of them may gain a scope merely because this shipped. A client
 *      opts in by recording the group it was provisioned from.
 *   2. **Union, never replace.** The predecessor wrote
 *      `data: { scopes: REQUIRED_SCOPES }`, silently stripping any scope a
 *      client legitimately held beyond that list.
 *   3. **Never the wildcard.** `validateRegisterableScopes` strips `'*'` on
 *      purpose — it is granted only to session and legacy_mcp auth — so this
 *      must not become a back door to it. Filtered explicitly, not merely
 *      absent from the groups.
 *   4. **Bounded by the NAMED group**, never "everything in the enum". An
 *      unrecognised group name grants nothing rather than defaulting open.
 */
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { SCOPE_GROUPS, isScopeGroup, type OAuthScope } from './oauth-scopes'

const log = createLogger('oauth.scope-reconcile')

/** Granted only to session and legacy_mcp auth; never by reconciliation. */
const WILDCARD = '*'

export interface ScopeReconcileResult {
  changed: boolean
  /** Scopes added by this call, for the caller and for the audit line. */
  added: OAuthScope[]
}

const UNCHANGED: ScopeReconcileResult = { changed: false, added: [] }

/**
 * Top a client up to its scope group's current contents.
 *
 * Safe to call on every token issuance: it reads one row, and writes only when
 * the group genuinely contains something the client lacks.
 */
export async function reconcileClientScopes(clientId: string): Promise<ScopeReconcileResult> {
  const client = await prisma.oAuthClient.findUnique({
    where: { id: clientId },
    select: { id: true, scopes: true, scopeGroup: true },
  })

  // A client that has gone away is not an error worth throwing at a token
  // request — the caller's own lookup will fail informatively.
  if (!client) return UNCHANGED

  // Bound 1 and bound 4: unmarked, or marked with something that is not a
  // real group, grants nothing. Never a default-open fallback.
  if (!isScopeGroup(client.scopeGroup)) return UNCHANGED

  const held = new Set(client.scopes)
  const added = SCOPE_GROUPS[client.scopeGroup].filter(
    scope => scope !== WILDCARD && !held.has(scope),
  )

  if (added.length === 0) return UNCHANGED

  // Bound 2: union. Everything the client already held survives — including
  // scopes this group does not list, which are somebody's deliberate grant.
  // Bound 3: and the wildcard is never written by this path, even if the row
  // already carries one.
  const next = [...client.scopes, ...added].filter(scope => scope !== WILDCARD)

  await prisma.oAuthClient.update({
    where: { id: client.id },
    data: { scopes: next },
  })

  // Widening is a privilege change; it should be greppable after the fact.
  log.info(
    { clientId: client.id, scopeGroup: client.scopeGroup, added },
    'Reconciled OAuth client scopes to its scope group',
  )

  return { changed: true, added }
}
