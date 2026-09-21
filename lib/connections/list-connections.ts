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
 *
 * Five sources, but not five TYPES: three of them are one `OAuthClient` table
 * differing only in who owns the row. Each row therefore leaves here stamped
 * with the `category`/`owner` facets a reader groups by — applied once, at the
 * end, so no builder can disagree with connection-taxonomy.ts (AWTD-981).
 */

import { prisma } from '@/lib/prisma'
import { listUserOAuthClients } from '@/lib/oauth/oauth-client-manager'
import { decryptField } from '@/lib/field-encryption'
import { agentEmail } from '@/lib/brand/agent-emails'
import { listMyCustomAgentUsers } from '@/lib/custom-agents/list-my-agents'
import { withTaxonomy } from '@/lib/connections/connection-taxonomy'
import type { V1Connection } from '@/lib/api-contracts/v1-ios-shapes'

/**
 * A row as its builder writes it. The `category` and `owner` facets are added
 * once, in `listConnections`, from the kind — see connection-taxonomy.ts.
 */
type ConnectionRow = Omit<V1Connection, 'category' | 'owner'>

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
    .map(withCoherentUsage)
    .map(withTaxonomy)
}

/**
 * Drop a `lastUsedAt` that precedes the row's own `createdAt` (AWTD-983).
 *
 * The two dates do not always come from the same record. An `authorizedApp`
 * reads its usage from `OAuthClient.lastUsedAt`, one column on a client row
 * that dynamic registration SHARES between everyone who approved that app — so
 * the last use can belong to another person and predate this reader's grant
 * entirely. A use that happened before the connection existed is not a fact
 * about the connection, and "Never" is the honest way to say we have none.
 *
 * Applied once, next to the taxonomy stamp, for the same reason: an invariant
 * every row must hold belongs in one place rather than in each builder.
 */
function withCoherentUsage(connection: ConnectionRow): ConnectionRow {
  if (!connection.lastUsedAt || connection.lastUsedAt >= connection.createdAt) return connection
  return { ...connection, lastUsedAt: null }
}

/** OAuth clients the user created in the developer console (or via a preset). */
async function ownedClients(userId: string): Promise<ConnectionRow[]> {
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
async function authorizedApps(userId: string): Promise<ConnectionRow[]> {
  const now = new Date()
  const [tokens, firstGrants] = await Promise.all([
    prisma.oAuthToken.findMany({
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
    }),
    firstGrantByClient(userId),
  ])

  const byClient = new Map<string, ConnectionRow>()
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
        createdAt: firstGrants.get(token.client.id) ?? new Date(token.createdAt).toISOString(),
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

/**
 * When this user first got a token for each client — the date the row means by
 * "Created" (AWTD-983).
 *
 * It cannot be read off the live tokens, because refreshing REVOKES the row it
 * replaces (`refreshAccessToken`) — so the oldest live token dates from the
 * last refresh, an hour ago, on an app connected since spring. Revoked rows are
 * therefore exactly the ones to count: they are the earlier links of the same
 * chain, not withdrawn consent.
 *
 * `cleanupExpiredTokens` drops rows seven days after they expire, so this is
 * "connected at least since", never earlier than the truth.
 */
async function firstGrantByClient(userId: string): Promise<Map<string, string>> {
  const grants = await prisma.oAuthToken.groupBy({
    by: ['clientId'],
    where: { userId },
    _min: { createdAt: true },
  })
  return new Map(
    grants.flatMap(grant => {
      const first = iso(grant._min.createdAt)
      return first ? [[grant.clientId, first] as const] : []
    })
  )
}

/** Custom Agents the user registered: the client belongs to the bot user, so it never shows under ownedClients. */
async function customAgents(userId: string): Promise<ConnectionRow[]> {
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
async function accessTokens(userId: string): Promise<ConnectionRow[]> {
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

async function webhookServer(userId: string): Promise<ConnectionRow[]> {
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
