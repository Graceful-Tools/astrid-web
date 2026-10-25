/**
 * Minting a user-level access token (an MCPToken row with no list) — the one
 * long-lived static bearer the product offers, which the GitHub.com Copilot
 * agent needs.
 *
 * Two routes mint it: POST /api/mcp/user-tokens (the web hub, session only by
 * construction) and POST /api/v1/users/me/access-tokens (AWTD-1312, for the
 * clients held to v1). Both call this, so the body they accept, the agent
 * binding and the refusals cannot drift apart. Listing and revoking are
 * /api/v1/users/me/connections.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { agentEmail } from '@/lib/brand/agent-emails'
import { CONSENT_AGENT_MAILBOXES } from '@/lib/oauth/agent-consent'
import { mcpTokenStorageFields } from '@/lib/mcp-token'
import { generateMCPToken } from '@/lib/mcp-token-utils'
import { ensureAgentUser } from '@/lib/ai/ensure-agent-user'

export const MintAccessTokenSchema = z.object({
  permissions: z.array(z.enum(['read', 'write'])).min(1, 'At least one permission required'),
  expiresInDays: z.number().min(1).max(365).optional(),
  description: z.string().optional(),
  // Same roster the OAuth consent screen offers, so a token minted here and one
  // minted through the consent flow can carry the same identities.
  agent: z.enum(CONSENT_AGENT_MAILBOXES).optional(),
})

export type MintAccessTokenInput = z.infer<typeof MintAccessTokenSchema>

export type MintAccessTokenResult =
  | {
      ok: true
      token: string
      permissions: string[]
      expiresAt: Date | null
      description: string | null
      createdAt: Date
    }
  | { ok: false; status: 403 | 409; error: string }

export async function mintAccessToken(
  userId: string,
  input: MintAccessTokenInput
): Promise<MintAccessTokenResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { mcpEnabled: true },
  })
  if (!user?.mcpEnabled) {
    return { ok: false, status: 403, error: 'MCP access is disabled for your account' }
  }

  let agentUserId: string | null = null
  if (input.agent) {
    const agentUser = await ensureAgentUser(agentEmail(input.agent))
    if (!agentUser) {
      return { ok: false, status: 409, error: 'The requested AI agent identity is not configured' }
    }
    agentUserId = agentUser.id
  }

  const token = generateMCPToken()
  const expiresAt = input.expiresInDays
    ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
    : null

  const row = await prisma.mCPToken.create({
    data: {
      ...mcpTokenStorageFields(token),
      listId: null, // User-level tokens have no specific list
      userId,
      agentUserId,
      agentMailbox: input.agent ?? null,
      permissions: input.permissions,
      expiresAt,
      description: input.description,
      isActive: true,
    },
  })

  return {
    ok: true,
    token,
    permissions: row.permissions,
    expiresAt: row.expiresAt,
    description: row.description,
    createdAt: row.createdAt,
  }
}
