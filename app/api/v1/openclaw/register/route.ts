/**
 * POST /api/v1/openclaw/register
 *
 * Register an OpenClaw agent identity. Creates a {name}.oc@astrid.cc user
 * and OAuth client credentials for the agent.
 *
 * Auth: OAuth Bearer token or session (user must be authenticated)
 * Body: { agentName: string, listIds?: string[] }
 * Returns: { agent, oauth, config }
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createOAuthClient } from '@/lib/oauth/oauth-client-manager'
import { checkAgentRateLimit, addRateLimitHeaders, AGENT_RATE_LIMITS } from '@/lib/agent-rate-limiter'
import { withAuth } from '@/lib/api-auth-wrapper'
import { createLogger } from '@/lib/logger'
import { getUserRoleInList } from "@/lib/list-permissions"

const log = createLogger('v1.openclaw.register')

// Reserved names that cannot be used for agent registration
const RESERVED_NAMES = ['admin', 'system', 'test', 'api', 'support', 'root', 'openclaw']

// Name validation: lowercase alphanumeric + dots/hyphens/underscores, 2-32 chars
const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,30}[a-z0-9]$/

export const POST = withAuth(
  { tag: 'v1.openclaw.register' },
  async (req, auth) => {
    const rateCheck = await checkAgentRateLimit(req, auth, AGENT_RATE_LIMITS.REGISTRATION)
    if (rateCheck.response) return rateCheck.response

    const baseUrl = (process.env.NEXTAUTH_URL || 'https://www.astrid.cc').replace(/\/+$/, '')

    const body = await req.json()
    const { agentName, listIds } = body

    if (!agentName || typeof agentName !== 'string') {
      return NextResponse.json(
        { error: 'agentName is required' },
        { status: 400 }
      )
    }

    const name = agentName.toLowerCase().trim()

    if (!NAME_PATTERN.test(name)) {
      return NextResponse.json(
        { error: 'Invalid agent name. Must be 2-32 characters, lowercase alphanumeric with dots, hyphens, or underscores. Must start and end with alphanumeric.' },
        { status: 400 }
      )
    }

    if (RESERVED_NAMES.includes(name)) {
      return NextResponse.json(
        { error: `The name "${name}" is reserved and cannot be used.` },
        { status: 400 }
      )
    }

    const agentEmail = `${name}.oc@astrid.cc`

    const existingUser = await prisma.user.findUnique({
      where: { email: agentEmail }
    })

    if (existingUser) {
      return NextResponse.json(
        { error: `Agent "${name}" already exists (${agentEmail})` },
        { status: 409 }
      )
    }

    const agentUser = await prisma.user.create({
      data: {
        email: agentEmail,
        name: `${name} (OpenClaw)`,
        image: '/images/ai-agents/openclaw.svg',
        isAIAgent: true,
        aiAgentType: 'openclaw_worker',
        aiAgentConfig: JSON.stringify({
          registeredBy: auth.userId,
          agentName: name,
          version: '1.0',
          registeredAt: new Date().toISOString(),
        }),
        isActive: true,
      }
    })

    const oauthClient = await createOAuthClient({
      userId: agentUser.id,
      name: `OpenClaw Agent: ${name}`,
      description: `OAuth client for OpenClaw agent ${agentEmail}`,
      scopes: ['tasks:read', 'tasks:write', 'comments:read', 'comments:write', 'sse:connect'],
      grantTypes: ['client_credentials'],
    })

    if (listIds && Array.isArray(listIds)) {
      for (const listId of listIds) {
        if (typeof listId !== 'string') continue
        // IDOR guard: only add the agent to a list the CALLER owns or admins.
        // Previously any caller-supplied listId was honored, granting the new
        // agent (whose credentials are returned to the caller) member access
        // to arbitrary lists.
        const list = await prisma.taskList.findUnique({
          where: { id: listId },
          select: {
            ownerId: true,
            listMembers: { where: { userId: auth.userId }, select: { userId: true, role: true } },
          },
        })
        const callerRole = list ? getUserRoleInList({ id: auth.userId }, list as never) : null
        if (callerRole !== 'owner' && callerRole !== 'admin') {
          log.error({ listId, userId: auth.userId }, 'Refused agent list-add: caller is not owner/admin')
          continue
        }
        try {
          await prisma.listMember.create({
            data: {
              userId: agentUser.id,
              listId,
              role: 'member',
            }
          })
        } catch (error) {
          log.error({ err: error, listId }, 'Failed to add agent to list')
          // Don't fail registration if list membership fails
        }
      }
    }

    log.info(
      { agentEmail, registeredBy: auth.user.email },
      'Created OpenClaw agent'
    )

    return addRateLimitHeaders(
      NextResponse.json({
        agent: {
          id: agentUser.id,
          email: agentUser.email,
          name: agentUser.name,
          aiAgentType: 'openclaw_worker',
        },
        oauth: {
          clientId: oauthClient.clientId,
          clientSecret: oauthClient.clientSecret,
          scopes: oauthClient.scopes,
        },
        config: {
          sseEndpoint: `${baseUrl}/api/v1/agent/events`,
          apiBase: `${baseUrl}/api/v1`,
          tokenEndpoint: `${baseUrl}/api/v1/oauth/token`,
        }
      }, { status: 201 }),
      rateCheck.headers
    )
  }
)
