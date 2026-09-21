/**
 * RED for AWTD-981 — five names for what are really two types and a facet.
 *
 * `oauthClient`, `authorizedApp` and `customAgent` are not three types. They
 * are one table (`OAuthClient`) holding one credential (client id + secret),
 * fetched by three queries whose only difference is what `userId` equals: you,
 * null, or a bot user you made. That is an OWNER, not a type — so the page
 * that shows them as three adjacent sections is showing an implementation
 * detail as a taxonomy.
 *
 * This module says the real shape once, so the API and the page cannot
 * disagree about it. `kind` is deliberately left alone: it is the path segment
 * of `DELETE /api/v1/users/me/connections/{kind}/{id}` and a field in the iOS
 * contract, so renaming it would break every native build in the wild.
 */

import { describe, it, expect } from 'vitest'
import {
  CONNECTION_CATEGORIES,
  CONNECTION_KINDS,
  CONNECTION_TAXONOMY,
  groupByCategory,
  isConnectionKind,
  withTaxonomy,
} from '@/lib/connections/connection-taxonomy'
import type { V1Connection, V1ConnectionKind } from '@/lib/api-contracts/v1-ios-shapes'

const bare = (kind: V1ConnectionKind, id: string): Omit<V1Connection, 'category' | 'owner'> => ({
  id,
  kind,
  name: id,
  actsAs: null,
  scopes: [],
  createdAt: '2026-09-01T10:00:00.000Z',
  lastUsedAt: null,
  expiresAt: null,
  status: 'active',
  revocable: true,
  manageIn: 'connections',
})

describe('connection taxonomy (AWTD-981)', () => {
  it('classifies every kind, with nothing left over', () => {
    // Totality in both directions: a kind added later without a category would
    // vanish from a grouped page rather than fail loudly here.
    expect(Object.keys(CONNECTION_TAXONOMY).sort()).toEqual([...CONNECTION_KINDS].sort())
    expect(new Set(Object.values(CONNECTION_TAXONOMY).map(entry => entry.category))).toEqual(
      new Set(CONNECTION_CATEGORIES)
    )
  })

  it('collapses the three OAuthClient kinds into one category with three owners', () => {
    const apps = (['oauthClient', 'authorizedApp', 'customAgent'] as const).map(
      kind => CONNECTION_TAXONOMY[kind]
    )
    expect(apps.map(entry => entry.category)).toEqual(['app', 'app', 'app'])
    expect(apps.map(entry => entry.owner)).toEqual(['you', 'thirdParty', 'agent'])
  })

  it('leaves the two that are genuinely their own thing alone', () => {
    // A bearer string with no client, no secret and no consent flow, and a
    // server Astrid calls OUT to. Neither has an owner facet to show.
    expect(CONNECTION_TAXONOMY.accessToken).toEqual({ category: 'token', owner: null })
    expect(CONNECTION_TAXONOMY.webhook).toEqual({ category: 'webhook', owner: null })
  })

  it('adds the facets to a row without disturbing what revokes it', () => {
    const row = withTaxonomy(bare('customAgent', 'agent-1'))
    expect(row.category).toBe('app')
    expect(row.owner).toBe('agent')
    expect(row.kind).toBe('customAgent')
    expect(row.id).toBe('agent-1')
  })

  it('still recognises every kind by name, for the revoke route', () => {
    for (const kind of CONNECTION_KINDS) expect(isConnectionKind(kind)).toBe(true)
    expect(isConnectionKind('app')).toBe(false)
    expect(isConnectionKind(null)).toBe(false)
  })

  it('groups a mixed list into sections, in display order', () => {
    const groups = groupByCategory([
      withTaxonomy(bare('webhook', 'webhook')),
      withTaxonomy(bare('accessToken', 'tok-1')),
      withTaxonomy(bare('authorizedApp', 'dcr-1')),
      withTaxonomy(bare('oauthClient', 'c1')),
    ])

    expect(groups.map(group => group.category)).toEqual(['app', 'token', 'webhook'])
    // Within a section the server's order survives — the page does not resort it.
    expect(groups[0].connections.map(c => c.id)).toEqual(['dcr-1', 'c1'])
  })

  it('omits a category nothing is in', () => {
    const groups = groupByCategory([withTaxonomy(bare('oauthClient', 'c1'))])
    expect(groups.map(group => group.category)).toEqual(['app'])
  })
})
