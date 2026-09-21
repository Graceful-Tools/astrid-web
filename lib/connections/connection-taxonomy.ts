/**
 * What the five connection kinds actually are: two types and a facet.
 *
 * `oauthClient`, `authorizedApp` and `customAgent` look like three types on
 * the Connections page, and they are not. They are one table (`OAuthClient`)
 * holding one credential (client id + secret), read by three queries whose
 * only difference is what `userId` equals — you, `null`, or a bot user you
 * created. That is an OWNER. Showing it as a type puts an implementation
 * detail on a settings screen and makes the page look five times as
 * complicated as the thing it describes.
 *
 * So a row carries two facets alongside its kind:
 *
 * - `category` — **app**, **token**, or **webhook**. What to group by.
 * - `owner` — for an app, whose it is. `null` for the other two, which have
 *   no owner distinction to draw.
 *
 * The webhook stays its own category rather than folding in with the apps.
 * Every other row answers "what can act as my account" — inbound, with an
 * `actsAs` and scopes. The webhook is the reverse — we call OUT to a server
 * of yours: `actsAs: null`, `scopes: []`. It is on the page because it is
 * revocable, not because it is the same kind of thing.
 *
 * `kind` is deliberately untouched. It is the path segment of
 * `DELETE /api/v1/users/me/connections/{kind}/{id}` and a field in the iOS
 * contract, so it is plumbing, not presentation: a client that adopted the
 * facets and dropped the kind would group beautifully and revoke nothing.
 */

import type {
  V1Connection,
  V1ConnectionCategory,
  V1ConnectionKind,
  V1ConnectionOwner,
} from '@/lib/api-contracts/v1-ios-shapes'

/** Section order on the page: what acts as you, then how, then what points out. */
export const CONNECTION_CATEGORIES: readonly V1ConnectionCategory[] = ['app', 'token', 'webhook']

/** The whole classification, in one place, keyed so a new kind cannot skip it. */
export const CONNECTION_TAXONOMY: Record<
  V1ConnectionKind,
  { category: V1ConnectionCategory; owner: V1ConnectionOwner | null }
> = {
  oauthClient: { category: 'app', owner: 'you' },
  authorizedApp: { category: 'app', owner: 'thirdParty' },
  customAgent: { category: 'app', owner: 'agent' },
  accessToken: { category: 'token', owner: null },
  webhook: { category: 'webhook', owner: null },
}

export const CONNECTION_KINDS: readonly V1ConnectionKind[] = Object.keys(
  CONNECTION_TAXONOMY
) as V1ConnectionKind[]

export function isConnectionKind(value: unknown): value is V1ConnectionKind {
  return typeof value === 'string' && (CONNECTION_KINDS as readonly string[]).includes(value)
}

/**
 * Stamp a row with its facets. Applied once where the list is assembled, so
 * no builder can emit an `owner` that disagrees with its own `kind`.
 */
export function withTaxonomy(connection: Omit<V1Connection, 'category' | 'owner'>): V1Connection {
  const { category, owner } = CONNECTION_TAXONOMY[connection.kind]
  return { ...connection, category, owner }
}

export interface ConnectionGroup {
  category: V1ConnectionCategory
  connections: V1Connection[]
}

/**
 * The rows as sections, in display order, skipping the empty ones — a heading
 * over nothing is a category the reader has to rule out for no reason.
 * Order WITHIN a section is left as given: the server already sorted it.
 */
export function groupByCategory(connections: V1Connection[]): ConnectionGroup[] {
  return CONNECTION_CATEGORIES.map(category => ({
    category,
    connections: connections.filter(connection => connection.category === category),
  })).filter(group => group.connections.length > 0)
}
