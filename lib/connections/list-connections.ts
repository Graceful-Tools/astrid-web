/**
 * Everything that can act as an account, in one list.
 *
 * Five credential sources, five tables, and until now no screen that showed
 * them together: a reader who approved Claude Code on the consent page had
 * no way to see that approval again, let alone withdraw it. This assembles
 * the audit view the consent page always promised.
 *
 * Every row says which identity it authors as (`actsAs`), because that is the
 * question an audit answers: not "what is this" but "what can it do as whom".
 */

import { prisma } from '@/lib/prisma'
import { listUserOAuthClients } from '@/lib/oauth/oauth-client-manager'
import { decryptField } from '@/lib/field-encryption'
import { agentEmail } from '@/lib/brand/agent-emails'
import { listMyCustomAgentUsers } from '@/lib/custom-agents/list-my-agents'
import type { V1Connection, V1ConnectionKind } from '@/lib/api-contracts/v1-ios-shapes'

export const CONNECTION_KINDS: readonly V1ConnectionKind[] = [
  'oauthClient',
  'authorizedApp',
  'customAgent',
  'accessToken',
  'webhook',
]

export function isConnectionKind(value: unknown): value is V1ConnectionKind {
  return typeof value === 'string' && (CONNECTION_KINDS as readonly string[]).includes(value)
}

/** The literal id of the single webhook row: there is one config per user. */
export const WEBHOOK_CONNECTION_ID = 'webhook'

const iso = (value: Date | string | null | undefined): string | null =>
  value ? new Date(value).toISOString() : null

export async function listConnections(userId: string): Promise<V1Connection[]> {
  const [owned, authorized, custom, tokens, webhook] = await Promise.all([
    ownedClients(userId),
    authorizedApps(userId),
    customAgents(userId),
    accessTokens(userId),
    webhookServer(userId),
  ])
  return [...owned, ...authorized, ...custom, ...tokens, ...webhook]
}

/** OAuth clients the user created in the developer console (or via a preset). */
async function ownedClients(userId: string): Promise<V1Connection[]> {
  const clients = await listUserOAuthClients(userId)
  return clients.map(client => ({
    id: client.id,
    kind: 'oauthClient',
    name: client.name,
    actsAs: null,
    scopes: client.scopes,
    createdAt: new Date(client.createdAt).toISOString(),
    lastUsedAt: iso(client.lastUsedAt),
    expiresAt: null,
    status: client.isActive ? 'active' : 'disabled',
    revocable: client.isActive,
    manageIn: 'connections',
    detail: {
      clientId: client.clientId,
      grantTypes: client.grantTypes,
      description: client.description,
    },
  }))
}

/**
 * Apps approved on the consent page. A dynamically registered client has no
 * owner (userId null) and is shared by everyone who approved it, so the
 * user's view of it is the set of THEIR live tokens, grouped by client.
 */
async function authorizedApps(userId: string): Promise<V1Connection[]> {
  const now = new Date()
  const tokens = await prisma.oAuthToken.findMany({
    where: {
      userId,
      revokedAt: null,
      OR: [{ expiresAt: { gt: now } }, { refreshExpiresAt: { gt: now } }],
    },
    include: {
      client: {
        select: { id: true, clientId: true, name: true, userId: true, lastUsedAt: true },
      },
    },
  })

  const byClient = new Map<string, V1Connection>()
  for (const token of tokens) {
    if (token.client.userId !== null) continue // an owned client is its own row
    const latest = [token.expiresAt, token.refreshExpiresAt]
      .filter((d): d is Date => !!d)
      .reduce<Date | null>((max, d) => (!max || d > max ? d : max), null)
    const existing = byClient.get(token.client.id)
    if (!existing) {
      byClient.set(token.client.id, {
        id: token.client.id,
        kind: 'authorizedApp',
        name: token.client.name,
        actsAs: token.agentMailbox ? agentEmail(token.agentMailbox) : null,
        scopes: [...token.scopes],
        createdAt: new Date(token.createdAt).toISOString(),
        lastUsedAt: iso(token.client.lastUsedAt),
        expiresAt: iso(latest),
        status: 'active',
        revocable: true,
        manageIn: 'connections',
        detail: { clientId: token.client.clientId, activeTokens: 1 },
      })
      continue
    }
    existing.scopes = [...new Set([...existing.scopes, ...token.scopes])]
    existing.createdAt = [existing.createdAt, new Date(token.createdAt).toISOString()].sort()[0]
    if (latest && (!existing.expiresAt || latest.toISOString() > existing.expiresAt)) {
      existing.expiresAt = latest.toISOString()
    }
    if (!existing.actsAs && token.agentMailbox) existing.actsAs = agentEmail(token.agentMailbox)
    existing.detail = { ...existing.detail, activeTokens: (existing.detail?.activeTokens ?? 0) + 1 }
  }
  return [...byClient.values()]
}

/** Custom Agents the user registered: the client belongs to the bot user, so it never shows under ownedClients. */
async function customAgents(userId: string): Promise<V1Connection[]> {
  const agents = await listMyCustomAgentUsers(userId, 'connections')
  if (agents.length === 0) return []
  const clients = await prisma.oAuthClient.findMany({
    where: { userId: { in: agents.map(agent => agent.id) }, isActive: true },
    select: { id: true, clientId: true, userId: true, scopes: true, grantTypes: true, createdAt: true, lastUsedAt: true },
  })
  const clientByAgent = new Map(clients.map(client => [client.userId, client]))
  return agents.map(agent => {
    const client = clientByAgent.get(agent.id)
    return {
      id: agent.id,
      kind: 'customAgent',
      name: agent.config.agentName || agent.name || agent.email.split('.oc@')[0],
      actsAs: agent.email,
      scopes: client?.scopes ?? [],
      createdAt: new Date(agent.config.registeredAt ?? agent.createdAt ?? Date.now()).toISOString(),
      lastUsedAt: iso(client?.lastUsedAt),
      expiresAt: null,
      status: 'active',
      revocable: true,
      manageIn: 'agents',
      detail: { agentId: agent.id, clientId: client?.clientId, grantTypes: client?.grantTypes },
    }
  })
}

/**
 * User-level access tokens (MCPToken rows without a list). The API grants
 * these everything today (lib/api-auth-middleware returns '*'), so the audit
 * row says '*' rather than a narrower list nothing enforces; the raw
 * permissions ride along in `detail` for the day that changes.
 */
async function accessTokens(userId: string): Promise<V1Connection[]> {
  const now = new Date()
  const tokens = await prisma.mCPToken.findMany({
    where: { userId, listId: null, isActive: true },
    select: {
      id: true,
      description: true,
      permissions: true,
      createdAt: true,
      expiresAt: true,
      agentMailbox: true,
      agentUser: { select: { email: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
  return tokens.map(token => {
    const expired = !!token.expiresAt && new Date(token.expiresAt) <= now
    return {
      id: token.id,
      kind: 'accessToken',
      name: token.description || 'Access token',
      actsAs: token.agentUser?.email ?? (token.agentMailbox ? agentEmail(token.agentMailbox) : null),
      scopes: ['*'],
      createdAt: new Date(token.createdAt).toISOString(),
      lastUsedAt: null,
      expiresAt: iso(token.expiresAt),
      status: expired ? 'expired' : 'active',
      revocable: !expired,
      manageIn: 'agents',
      detail: { permissions: token.permissions },
    }
  })
}

async function webhookServer(userId: string): Promise<V1Connection[]> {
  const config = await prisma.userWebhookConfig.findUnique({ where: { userId } })
  if (!config) return []
  const url = decryptField(config.webhookUrl)
  let name = 'Webhook server'
  try {
    if (url) name = new URL(url).host
  } catch {
    // an undecodable URL still gets a row; the reader can revoke it
  }
  return [{
    id: WEBHOOK_CONNECTION_ID,
    kind: 'webhook',
    name,
    actsAs: null,
    scopes: [],
    createdAt: new Date(config.createdAt).toISOString(),
    lastUsedAt: iso(config.lastFiredAt),
    expiresAt: null,
    status: config.enabled ? 'active' : 'disabled',
    revocable: true,
    manageIn: 'agents',
    detail: { webhookUrl: url ?? undefined },
  }]
}
