/**
 * RED for AWTD-980 — reviewConnections: which of the things that can act as
 * this account look unused enough to be worth revoking.
 *
 * The connections screen already shows Created and Last used on every row and
 * leaves the reader to do the arithmetic. This is that arithmetic, in one
 * place, so the page can say "nothing has used this in four months" instead of
 * printing a date.
 *
 * The suggestion must be conservative in one specific direction: telling
 * someone to revoke a credential that is in use breaks whatever is using it,
 * while failing to mention an idle one costs nothing. Two rules follow from
 * that — a kind whose usage is not recorded is never flagged (an access token
 * has no lastUsedAt column at all, so every one of them reports "never"), and
 * a row that cannot be revoked is never suggested, because there is no action
 * behind the advice.
 */
import { describe, it, expect } from 'vitest'
import {
  reviewConnections,
  connectionKey,
  IDLE_AFTER_DAYS,
  NEVER_USED_AFTER_DAYS,
} from '@/lib/connections/review-connections'
import type { V1Connection } from '@/lib/api-contracts/v1-ios-shapes'

const NOW = new Date('2026-09-20T10:00:00.000Z')

const daysBefore = (days: number): string =>
  new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString()

const row = (overrides: Partial<V1Connection> = {}): V1Connection => ({
  id: 'c1',
  kind: 'oauthClient',
  name: 'Row',
  actsAs: null,
  scopes: [],
  createdAt: daysBefore(400),
  lastUsedAt: daysBefore(1),
  expiresAt: null,
  status: 'active',
  revocable: true,
  manageIn: 'connections',
  ...overrides,
})

describe('reviewConnections (AWTD-980)', () => {
  it('flags a connection that has not been used in longer than the idle window', () => {
    const reviews = reviewConnections([row({ lastUsedAt: daysBefore(120) })], NOW)
    expect(reviews).toEqual([
      { kind: 'oauthClient', id: 'c1', reason: 'idle', days: 120 },
    ])
  })

  it('leaves a recently used connection alone', () => {
    expect(reviewConnections([row({ lastUsedAt: daysBefore(IDLE_AFTER_DAYS - 1) })], NOW)).toEqual([])
  })

  it('flags a connection created long ago that has never been used', () => {
    const reviews = reviewConnections(
      [row({ createdAt: daysBefore(45), lastUsedAt: null })],
      NOW
    )
    expect(reviews).toEqual([
      { kind: 'oauthClient', id: 'c1', reason: 'neverUsed', days: 45 },
    ])
  })

  it('gives a new connection time to be used before calling it unused', () => {
    const fresh = row({ createdAt: daysBefore(NEVER_USED_AFTER_DAYS - 1), lastUsedAt: null })
    expect(reviewConnections([fresh], NOW)).toEqual([])
  })

  it('never flags an access token, whose usage is not recorded at all', () => {
    // MCPToken has no lastUsedAt column, so listConnections reports null for
    // every access token — the working ones and the forgotten ones alike.
    const token = row({ kind: 'accessToken', createdAt: daysBefore(400), lastUsedAt: null })
    expect(reviewConnections([token], NOW)).toEqual([])
  })

  it('does not suggest revoking a row that cannot be revoked', () => {
    const disabled = row({ status: 'disabled', revocable: false, lastUsedAt: daysBefore(400) })
    expect(reviewConnections([disabled], NOW)).toEqual([])
  })

  it('reviews the other kinds that do record usage', () => {
    const reviews = reviewConnections(
      [
        row({ id: 'a1', kind: 'authorizedApp', lastUsedAt: daysBefore(200) }),
        row({ id: 'g1', kind: 'customAgent', lastUsedAt: daysBefore(150) }),
        row({ id: 'webhook', kind: 'webhook', lastUsedAt: daysBefore(100) }),
      ],
      NOW
    )
    expect(reviews.map(r => r.kind)).toEqual(['authorizedApp', 'customAgent', 'webhook'])
  })

  it('puts the stalest connection first', () => {
    const reviews = reviewConnections(
      [
        row({ id: 'recent', lastUsedAt: daysBefore(100) }),
        row({ id: 'ancient', lastUsedAt: daysBefore(300) }),
        row({ id: 'middle', lastUsedAt: daysBefore(200) }),
      ],
      NOW
    )
    expect(reviews.map(r => r.id)).toEqual(['ancient', 'middle', 'recent'])
  })

  it('does not flag a connection whose dates are in the future', () => {
    // Clock skew between a client and the server must not read as staleness.
    const skewed = row({ createdAt: daysBefore(-10), lastUsedAt: daysBefore(-5) })
    expect(reviewConnections([skewed], NOW)).toEqual([])
  })

  it('keys a review the same way the list keys its rows', () => {
    const connection = row({ kind: 'customAgent', id: 'agent-7' })
    const [review] = reviewConnections([{ ...connection, lastUsedAt: daysBefore(365) }], NOW)
    expect(connectionKey(review)).toBe(connectionKey(connection))
    expect(connectionKey(connection)).toBe('customAgent:agent-7')
  })
})
