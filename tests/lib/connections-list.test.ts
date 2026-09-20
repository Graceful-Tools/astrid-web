/**
 * listConnections — one list of everything that can act as an account.
 *
 * Five sources, each with its own table, none of which any settings screen
 * showed together: owned OAuth clients, apps authorised through consent
 * (dynamically registered, unowned clients), Custom Agents (clients owned by
 * a bot user the caller registered), user-level access tokens, and the
 * webhook server. The point of the helper is that a reader sees all five in
 * one place, with the identity each one authors as.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BRAND } from '@/lib/brand/config'

const tokenFindMany = vi.hoisted(() => vi.fn())
const clientFindMany = vi.hoisted(() => vi.fn())
const mcpFindMany = vi.hoisted(() => vi.fn())
const webhookFindUnique = vi.hoisted(() => vi.fn())
const userFindMany = vi.hoisted(() => vi.fn())
const listClients = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    oAuthToken: { findMany: tokenFindMany },
    oAuthClient: { findMany: clientFindMany },
    mCPToken: { findMany: mcpFindMany },
    userWebhookConfig: { findUnique: webhookFindUnique },
    user: { findMany: userFindMany },
  },
}))
vi.mock('@/lib/oauth/oauth-client-manager', () => ({ listUserOAuthClients: listClients }))
vi.mock('@/lib/field-encryption', () => ({ decryptField: (v: string) => `dec:${v}` }))

import { listConnections } from '@/lib/connections/list-connections'

const NOW = new Date('2026-09-20T10:00:00Z')
const LATER = new Date('2026-10-20T10:00:00Z')
const EARLIER = new Date('2026-09-01T10:00:00Z')

describe('listConnections', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listClients.mockResolvedValue([])
    tokenFindMany.mockResolvedValue([])
    clientFindMany.mockResolvedValue([])
    mcpFindMany.mockResolvedValue([])
    webhookFindUnique.mockResolvedValue(null)
    userFindMany.mockResolvedValue([])
  })

  it('lists an owned client as oauthClient, revocable, managed here', async () => {
    listClients.mockResolvedValue([{
      id: 'c1', clientId: 'astrid_client_1', name: 'My script', description: null,
      redirectUris: [], grantTypes: ['client_credentials'], scopes: ['tasks:read'],
      scopeGroup: null, isActive: true, createdAt: EARLIER, updatedAt: EARLIER, lastUsedAt: NOW,
    }])
    const [row] = await listConnections('user-1')
    expect(row).toMatchObject({
      id: 'c1', kind: 'oauthClient', name: 'My script', scopes: ['tasks:read'],
      status: 'active', revocable: true, manageIn: 'connections',
      detail: { clientId: 'astrid_client_1', grantTypes: ['client_credentials'] },
    })
    expect(row.lastUsedAt).toBe(NOW.toISOString())
    expect(listClients).toHaveBeenCalledWith('user-1')
  })

  it('groups consent-authorised tokens by client and names the agent they author as', async () => {
    const claudeCode = { id: 'dcr-1', clientId: 'astrid_client_dcr', name: 'Claude Code', userId: null, lastUsedAt: NOW }
    tokenFindMany.mockResolvedValue([
      { id: 't1', clientId: 'dcr-1', scopes: ['tasks:read', 'tasks:write'], agentMailbox: 'claude', createdAt: EARLIER, expiresAt: NOW, refreshExpiresAt: LATER, client: claudeCode },
      { id: 't2', clientId: 'dcr-1', scopes: ['tasks:read'], agentMailbox: 'claude', createdAt: NOW, expiresAt: LATER, refreshExpiresAt: null, client: claudeCode },
      // An OWNED client's token is the oauthClient row's business, not a second entry.
      { id: 't3', clientId: 'own-1', scopes: ['tasks:read'], agentMailbox: null, createdAt: NOW, expiresAt: LATER, refreshExpiresAt: null, client: { id: 'own-1', clientId: 'astrid_client_own', name: 'My script', userId: 'user-1', lastUsedAt: null } },
    ])
    const rows = await listConnections('user-1')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: 'dcr-1', kind: 'authorizedApp', name: 'Claude Code',
      actsAs: `claude@${BRAND.agentEmailDomain}`,
      scopes: ['tasks:read', 'tasks:write'],
      revocable: true, manageIn: 'connections',
      detail: { activeTokens: 2 },
    })
    expect(rows[0].expiresAt).toBe(LATER.toISOString())
    // Only live tokens count: the query itself excludes revoked and expired ones.
    const where = tokenFindMany.mock.calls[0][0].where
    expect(where.userId).toBe('user-1')
    expect(where.revokedAt).toBeNull()
  })

  it('lists a Custom Agent the caller registered, and not one somebody else did', async () => {
    userFindMany.mockResolvedValue([
      { id: 'agent-1', email: `nightly.oc@${BRAND.domain}`, name: 'nightly', image: null, createdAt: EARLIER, aiAgentConfig: JSON.stringify({ registeredBy: 'user-1', agentName: 'nightly' }) },
      { id: 'agent-2', email: `other.oc@${BRAND.domain}`, name: 'other', image: null, createdAt: EARLIER, aiAgentConfig: JSON.stringify({ registeredBy: 'user-2', agentName: 'other' }) },
    ])
    clientFindMany.mockResolvedValue([
      { id: 'ac-1', clientId: 'astrid_client_agent', userId: 'agent-1', name: 'Custom Agent: nightly', scopes: ['tasks:read'], grantTypes: ['client_credentials'], isActive: true, createdAt: EARLIER, lastUsedAt: NOW },
    ])
    const rows = await listConnections('user-1')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: 'agent-1', kind: 'customAgent', name: 'nightly',
      actsAs: `nightly.oc@${BRAND.domain}`, revocable: true, manageIn: 'agents',
      detail: { agentId: 'agent-1', clientId: 'astrid_client_agent' },
    })
    expect(clientFindMany.mock.calls[0][0].where.userId).toEqual({ in: ['agent-1'] })
  })

  it('lists a user-level access token with the identity it is bound to, and never its plaintext', async () => {
    mcpFindMany.mockResolvedValue([{
      id: 'tok-1', token: 'hash', tokenEncrypted: 'enc', description: 'GitHub Copilot cloud agent',
      permissions: ['read', 'write'], createdAt: EARLIER, expiresAt: LATER, isActive: true,
      agentMailbox: 'copilot', agentUser: { email: `copilot@${BRAND.agentEmailDomain}` },
    }])
    const [row] = await listConnections('user-1')
    expect(row).toMatchObject({
      id: 'tok-1', kind: 'accessToken', name: 'GitHub Copilot cloud agent',
      actsAs: `copilot@${BRAND.agentEmailDomain}`, revocable: true, manageIn: 'agents',
      detail: { permissions: ['read', 'write'] },
    })
    // The API grants these tokens everything today (lib/api-auth-middleware);
    // the audit list says so rather than showing a narrower list it does not enforce.
    expect(row.scopes).toEqual(['*'])
    expect(JSON.stringify(row)).not.toContain('enc')
    expect(JSON.stringify(row)).not.toContain('hash')
    const where = mcpFindMany.mock.calls[0][0].where
    expect(where).toMatchObject({ userId: 'user-1', listId: null, isActive: true })
  })

  it('lists the webhook server by host, decrypting the URL for display', async () => {
    webhookFindUnique.mockResolvedValue({
      webhookUrl: 'ciphertext', enabled: true, agents: ['claude'], createdAt: EARLIER, lastFiredAt: NOW,
    })
    const [row] = await listConnections('user-1')
    expect(row).toMatchObject({
      id: 'webhook', kind: 'webhook', status: 'active', revocable: true, manageIn: 'agents',
      detail: { webhookUrl: 'dec:ciphertext' },
    })
    expect(row.lastUsedAt).toBe(NOW.toISOString())
  })

  it('marks a disabled client and an expired token instead of hiding them', async () => {
    listClients.mockResolvedValue([{
      id: 'c1', clientId: 'x', name: 'Old', description: null, redirectUris: [], grantTypes: [],
      scopes: [], scopeGroup: null, isActive: false, createdAt: EARLIER, updatedAt: EARLIER, lastUsedAt: null,
    }])
    mcpFindMany.mockResolvedValue([{
      id: 'tok-1', description: null, permissions: ['read'], createdAt: EARLIER, expiresAt: EARLIER,
      isActive: true, agentMailbox: null, agentUser: null,
    }])
    const rows = await listConnections('user-1')
    expect(rows.find(r => r.kind === 'oauthClient')).toMatchObject({ status: 'disabled', revocable: false })
    expect(rows.find(r => r.kind === 'accessToken')).toMatchObject({ status: 'expired', revocable: false })
  })
})
