/**
 * `lists:configure` (AWTD-1504): the narrow list permission agents carry.
 *
 * `lists:write` also lets a token delete a list and reshape its membership and
 * visibility, which is more than setting up a workspace needs. `lists:configure`
 * reaches the same create/update routes but only for the fields an agent
 * legitimately sets: name, instructions (description), default assignee, colour.
 * Anything else on a request from a configure-only token is refused, never
 * silently dropped.
 */

import { hasRequiredScopes } from '@/lib/oauth/oauth-scopes'

export const LIST_CONFIGURE_FIELDS = ['name', 'description', 'defaultAssigneeId', 'color'] as const

/** What a route accepts in place of the broad scope. */
export const LIST_CONFIGURE_ROUTE_SCOPES = ['lists:write', 'lists:configure']

/**
 * An error message when this caller may not send this body, else null.
 * A token holding `lists:write` (or the wildcard) is unrestricted.
 */
export function listConfigureViolation(
  grantedScopes: readonly string[],
  body: object,
): string | null {
  if (hasRequiredScopes([...grantedScopes], ['lists:write'])) return null

  const fields = body as Record<string, unknown>
  const rejected = Object.keys(fields).filter(key => {
    if ((LIST_CONFIGURE_FIELDS as readonly string[]).includes(key)) return false
    // An agent's list is always private; stating it is harmless, changing it is not.
    return !(key === 'privacy' && fields[key] === 'PRIVATE')
  })
  if (rejected.length === 0) return null
  return `The lists:configure scope only allows ${LIST_CONFIGURE_FIELDS.join(', ')}; not allowed: ${rejected.join(', ')}`
}
