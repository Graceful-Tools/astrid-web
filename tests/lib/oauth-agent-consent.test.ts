/**
 * Regression: the OAuth consent screen offered "Approve Access as copilot@astrid.cc"
 * to every connecting MCP client, so signing in from Claude Code granted Copilot's
 * identity and everything that session wrote was attributed to the wrong agent.
 *
 * The mailbox must follow the client's registered name, and the server must refuse a
 * grant for any identity other than the one that client resolves to.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    oAuthAuthorizationCode: { create: vi.fn().mockResolvedValue({ id: 'code-row' }) },
  },
}))

import {
  CONSENT_AGENT_MAILBOXES,
  normalizeStoredAgentMailbox,
  resolveConsentAgentMailbox,
} from '@/lib/oauth/agent-consent'
import { createAuthorizationRedirect } from '@/lib/oauth/oauth-authorization'

function publicClient(name: string) {
  return {
    id: 'db-client',
    clientId: 'astrid_client_dynamic',
    name,
    description: null,
    redirectUris: ['http://127.0.0.1:51000/callback'],
    grantTypes: ['authorization_code', 'refresh_token'],
    scopes: ['tasks:read'] as const,
    tokenEndpointAuthMethod: 'none',
    owner: null,
  }
}

function contextFor(name: string) {
  return {
    client: publicClient(name),
    redirectUri: 'http://127.0.0.1:51000/callback',
    scopes: ['tasks:read'] as const,
    codeChallenge: 'ImpiCd8pp4MveCNnbIS7-GXEtB0xF5HMIDoWqvGA5ig',
    codeChallengeMethod: 'S256' as const,
  }
}

describe('OAuth agent consent identity', () => {
  it.each([
    ['Claude Code (astrid)', 'claude'],
    ['Claude', 'claude'],
    ['GitHub Copilot', 'copilot'],
    ['Codex CLI', 'codex'],
    ['Gemini CLI', 'gemini'],
  ])('offers %s the %s identity', (clientName, mailbox) => {
    expect(resolveConsentAgentMailbox(publicClient(clientName))).toBe(mailbox)
  })

  it('offers no agent identity to a client it cannot place', () => {
    expect(resolveConsentAgentMailbox(publicClient('MCP Client'))).toBeNull()
  })

  it('offers no agent identity to a confidential client', () => {
    expect(
      resolveConsentAgentMailbox({
        ...publicClient('Claude Code'),
        tokenEndpointAuthMethod: 'client_secret_post',
      }),
    ).toBeNull()
  })

  it('offers no agent identity to an owned client', () => {
    expect(
      resolveConsentAgentMailbox({ ...publicClient('Claude Code'), owner: { id: 'owner-1' } }),
    ).toBeNull()
  })

  it('grants Claude Code the claude identity, not copilot', async () => {
    const { prisma } = await import('@/lib/prisma')
    await createAuthorizationRedirect('user-1', contextFor('Claude Code (astrid)'), 'claude')
    expect(prisma.oAuthAuthorizationCode.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ agentMailbox: 'claude' }),
    })
  })

  it('refuses an identity the connecting client does not resolve to', async () => {
    await expect(
      createAuthorizationRedirect('user-1', contextFor('Claude Code (astrid)'), 'copilot'),
    ).rejects.toThrow(/copilot agent identity is not available/i)
  })

  it('normalizes only mailboxes on the consent roster', () => {
    expect(normalizeStoredAgentMailbox(null)).toBeUndefined()
    expect(normalizeStoredAgentMailbox('astrid')).toBeUndefined()
    expect(normalizeStoredAgentMailbox('nonsense')).toBeUndefined()
    for (const mailbox of CONSENT_AGENT_MAILBOXES) {
      expect(normalizeStoredAgentMailbox(mailbox)).toBe(mailbox)
    }
  })
})
