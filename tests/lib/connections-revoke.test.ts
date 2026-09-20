/**
 * revokeConnection — stop one credential without touching its neighbours.
 *
 * The sharp edge is the consent-authorised client: a dynamically registered
 * public client (Claude Code, VS Code) is ONE row shared by every account that
 * ever approved it. The existing revokeAllClientTokens helper revokes every
 * user's tokens for that client. Connections must revoke only the caller's.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const tokenUpdateMany = vi.hoisted(() => vi.fn())
const mcpFindFirst = vi.hoisted(() => vi.fn())
const mcpUpdate = vi.hoisted(() => vi.fn())
const webhookFindUnique = vi.hoisted(() => vi.fn())
const webhookDelete = vi.hoisted(() => vi.fn())
const userFindUnique = vi.hoisted(() => vi.fn())
const userDelete = vi.hoisted(() => vi.fn())
const clientFindFirst = vi.hoisted(() => vi.fn())
const updateClient = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    oAuthToken: { updateMany: tokenUpdateMany },
    oAuthClient: { findFirst: clientFindFirst },
    mCPToken: { findFirst: mcpFindFirst, update: mcpUpdate },
    userWebhookConfig: { findUnique: webhookFindUnique, delete: webhookDelete },
    user: { findUnique: userFindUnique, delete: userDelete },
  },
}))
vi.mock('@/lib/oauth/oauth-client-manager', () => ({ updateOAuthClient: updateClient }))
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))

import { ConnectionNotFoundError, revokeConnection } from '@/lib/connections/revoke-connection'

describe('revokeConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tokenUpdateMany.mockResolvedValue({ count: 0 })
  })

  it('authorizedApp: revokes only the CALLER\'s tokens for the shared client', async () => {
    tokenUpdateMany.mockResolvedValue({ count: 2 })
    const result = await revokeConnection('user-1', 'authorizedApp', 'dcr-1')
    expect(result).toEqual({ kind: 'authorizedApp', id: 'dcr-1', revokedTokens: 2 })
    const call = tokenUpdateMany.mock.calls[0][0]
    expect(call.where).toMatchObject({ clientId: 'dcr-1', userId: 'user-1', revokedAt: null })
    expect(call.data.revokedAt).toBeInstanceOf(Date)
  })

  it('authorizedApp: nothing to revoke is not found, not silently fine', async () => {
    tokenUpdateMany.mockResolvedValue({ count: 0 })
    await expect(revokeConnection('user-1', 'authorizedApp', 'dcr-1')).rejects.toBeInstanceOf(ConnectionNotFoundError)
  })

  it('oauthClient: disables the owned client and revokes its live tokens', async () => {
    clientFindFirst.mockResolvedValue({ id: 'c1', clientId: 'astrid_client_1', userId: 'user-1' })
    tokenUpdateMany.mockResolvedValue({ count: 1 })
    const result = await revokeConnection('user-1', 'oauthClient', 'c1')
    expect(clientFindFirst.mock.calls[0][0].where).toMatchObject({ id: 'c1', userId: 'user-1' })
    expect(updateClient).toHaveBeenCalledWith('astrid_client_1', 'user-1', { isActive: false })
    expect(tokenUpdateMany.mock.calls[0][0].where).toMatchObject({ clientId: 'c1', userId: 'user-1' })
    expect(result).toEqual({ kind: 'oauthClient', id: 'c1', revokedTokens: 1 })
  })

  it('oauthClient: another user\'s client is not found', async () => {
    clientFindFirst.mockResolvedValue(null)
    await expect(revokeConnection('user-1', 'oauthClient', 'c1')).rejects.toBeInstanceOf(ConnectionNotFoundError)
    expect(updateClient).not.toHaveBeenCalled()
  })

  it('accessToken: deactivates a user-level token the caller owns', async () => {
    mcpFindFirst.mockResolvedValue({ id: 'tok-1', userId: 'user-1', listId: null })
    const result = await revokeConnection('user-1', 'accessToken', 'tok-1')
    expect(mcpFindFirst.mock.calls[0][0].where).toMatchObject({ id: 'tok-1', userId: 'user-1', listId: null, isActive: true })
    expect(mcpUpdate).toHaveBeenCalledWith({ where: { id: 'tok-1' }, data: { isActive: false } })
    expect(result).toEqual({ kind: 'accessToken', id: 'tok-1' })
  })

  it('accessToken: a per-list token is not a user connection and is left alone', async () => {
    mcpFindFirst.mockResolvedValue(null)
    await expect(revokeConnection('user-1', 'accessToken', 'tok-1')).rejects.toBeInstanceOf(ConnectionNotFoundError)
    expect(mcpUpdate).not.toHaveBeenCalled()
  })

  it('customAgent: deletes a bot user the caller registered (cascades its client and tokens)', async () => {
    userFindUnique.mockResolvedValue({
      id: 'agent-1', email: 'nightly.oc@example.test', aiAgentType: 'openclaw_worker',
      aiAgentConfig: JSON.stringify({ registeredBy: 'user-1' }),
    })
    const result = await revokeConnection('user-1', 'customAgent', 'agent-1')
    expect(userDelete).toHaveBeenCalledWith({ where: { id: 'agent-1' } })
    expect(result).toEqual({ kind: 'customAgent', id: 'agent-1' })
  })

  it('customAgent: refuses one registered by somebody else', async () => {
    userFindUnique.mockResolvedValue({
      id: 'agent-1', email: 'x', aiAgentType: 'openclaw_worker',
      aiAgentConfig: JSON.stringify({ registeredBy: 'user-2' }),
    })
    await expect(revokeConnection('user-1', 'customAgent', 'agent-1')).rejects.toBeInstanceOf(ConnectionNotFoundError)
    expect(userDelete).not.toHaveBeenCalled()
  })

  it('webhook: removes the caller\'s webhook configuration', async () => {
    webhookFindUnique.mockResolvedValue({ userId: 'user-1' })
    const result = await revokeConnection('user-1', 'webhook', 'webhook')
    expect(webhookDelete).toHaveBeenCalledWith({ where: { userId: 'user-1' } })
    expect(result).toEqual({ kind: 'webhook', id: 'webhook' })
  })

  it('webhook: not configured is not found', async () => {
    webhookFindUnique.mockResolvedValue(null)
    await expect(revokeConnection('user-1', 'webhook', 'webhook')).rejects.toBeInstanceOf(ConnectionNotFoundError)
  })
})
