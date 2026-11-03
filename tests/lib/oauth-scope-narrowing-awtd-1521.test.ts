/**
 * AWTD-1521: removing a permission from a connection must reach the tokens it
 * already issued, at their next refresh, not only at the next sign-in.
 *
 * Rolled out dry-run first: with OAUTH_SCOPE_NARROWING unset, the re-issued
 * token keeps its old scopes and the drop is only logged.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { row } from '../fixtures/prisma-rows'
import { mockPrisma } from '../setup'
import {
  narrowToClientScopes,
  scopeNarrowingMode,
} from '@/lib/oauth/scope-narrowing'
import {
  exchangeAuthorizationCode,
  refreshAccessToken,
} from '@/lib/oauth/oauth-token-manager'

function issuedScopes(): string[] {
  return mockPrisma.oAuthToken.create.mock.calls.at(-1)?.[0]?.data?.scopes
}

function tokenRow(scopes: string[]) {
  return row({
    id: 'token-row',
    clientId: 'db-client',
    userId: 'user-1',
    scopes,
    agentMailbox: null,
  })
}

function codeRow(scopes: string[]) {
  return row({
    id: 'code-row',
    code: 'astrid_code_x',
    clientId: 'db-client',
    userId: 'user-1',
    redirectUri: 'https://example.test/cb',
    scopes,
    agentMailbox: null,
    codeChallenge: null,
    codeChallengeMethod: null,
    expiresAt: new Date(Date.now() + 60_000),
    usedAt: null,
    createdAt: new Date(),
  })
}

beforeEach(() => {
  mockPrisma.oAuthToken.create.mockResolvedValue(row({ id: 'new-token' }))
  mockPrisma.oAuthToken.update.mockResolvedValue(row({ id: 'token-row' }))
  mockPrisma.oAuthAuthorizationCode.update.mockResolvedValue(row({ id: 'code-row' }))
  mockPrisma.oAuthClient.findUnique.mockResolvedValue(
    row({ id: 'db-client', scopes: ['tasks:read'] }),
  )
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('narrowToClientScopes (AWTD-1521)', () => {
  it('keeps what the app still holds and reports the rest', () => {
    expect(narrowToClientScopes(['tasks:read', 'tasks:write'], ['tasks:read'])).toEqual({
      kept: ['tasks:read'],
      dropped: ['tasks:write'],
    })
  })

  it('never strips a token whose app holds the wildcard', () => {
    expect(narrowToClientScopes(['*', 'tasks:write'], ['*'])).toEqual({
      kept: ['*', 'tasks:write'],
      dropped: [],
    })
  })

  it('is dry-run unless the switch says exactly enforce', () => {
    expect(scopeNarrowingMode({})).toBe('dry-run')
    expect(scopeNarrowingMode({ OAUTH_SCOPE_NARROWING: 'yes' })).toBe('dry-run')
    expect(scopeNarrowingMode({ OAUTH_SCOPE_NARROWING: 'enforce' })).toBe('enforce')
  })
})

describe('re-issued tokens follow the app\'s current permissions (AWTD-1521)', () => {
  it('a refresh drops a permission the user removed, when enforcing', async () => {
    vi.stubEnv('OAUTH_SCOPE_NARROWING', 'enforce')
    mockPrisma.oAuthToken.findFirst.mockResolvedValue(tokenRow(['tasks:read', 'tasks:write']))

    const result = await refreshAccessToken('astrid_refresh_x', 'db-client')

    expect(issuedScopes()).toEqual(['tasks:read'])
    expect(result?.scope).toBe('tasks:read')
  })

  it('an unused authorization code drops it too, when enforcing', async () => {
    vi.stubEnv('OAUTH_SCOPE_NARROWING', 'enforce')
    mockPrisma.oAuthAuthorizationCode.findFirst.mockResolvedValue(
      codeRow(['tasks:read', 'tasks:write']),
    )

    await exchangeAuthorizationCode('astrid_code_x', 'db-client', 'https://example.test/cb')

    expect(issuedScopes()).toEqual(['tasks:read'])
  })

  it('in dry run, the refreshed token keeps its old permissions', async () => {
    vi.stubEnv('OAUTH_SCOPE_NARROWING', '')
    mockPrisma.oAuthToken.findFirst.mockResolvedValue(tokenRow(['tasks:read', 'tasks:write']))

    await refreshAccessToken('astrid_refresh_x', 'db-client')

    expect(issuedScopes()).toEqual(['tasks:read', 'tasks:write'])
  })
})
