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

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPI, UnauthorizedError, ForbiddenError } from '@/lib/api-auth-middleware'
import { prisma } from '@/lib/prisma'
import { createOAuthClient } from '@/lib/oauth/oauth-client-manager'
import { checkAgentRateLimit, addRateLimitHeaders, AGENT_RATE_LIMITS } from '@/lib/agent-rate-limiter'

// Reserved names that cannot be used for agent registration
const RESERVED_NAMES = ['admin', 'system', 'test', 'api', 'support', 'root', 'openclaw']

// Name validation: lowercase alphanumeric + dots/hyphens/underscores, 2-32 chars
const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,30}[a-z0-9]$/

export async function POST(req: NextRequest) {
  try {
    const auth = await authenticateAPI(req)

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

    // Validate name format
    if (!NAME_PATTERN.test(name)) {
      return NextResponse.json(
        { error: 'Invalid agent name. Must be 2-32 characters, lowercase alphanumeric with dots, hyphens, or underscores. Must start and end with alphanumeric.' },
        { status: 400 }
      )
    }

    // Check reserved names
    if (RESERVED_NAMES.includes(name)) {
      return NextResponse.json(
        { error: `The name "${name}" is reserved and cannot be used.` },
        { status: 400 }
      )
    }

    const agentEmail = `${name}.oc@astrid.cc`

    // Check if agent already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: agentEmail }
    })

    if (existingUser) {
      return NextResponse.json(
        { error: `Agent "${name}" already exists (${agentEmail})` },
        { status: 409 }
      )
    }

    // Create agent user record with default OpenClaw profile photo
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

    // Create OAuth client for the agent
    const oauthClient = await createOAuthClient({
      userId: agentUser.id,
      name: `OpenClaw Agent: ${name}`,
      description: `OAuth client for OpenClaw agent ${agentEmail}`,
      scopes: ['tasks:read', 'tasks:write', 'comments:read', 'comments:write', 'sse:connect'],
      grantTypes: ['client_credentials'],
    })

    // Optionally add agent as member to specified lists
    if (listIds && Array.isArray(listIds)) {
      for (const listId of listIds) {
        try {
          await prisma.listMember.create({
            data: {
              userId: agentUser.id,
              listId,
              role: 'member',
            }
          })
        } catch (error) {
          console.error(`[OpenClaw Register] Failed to add agent to list ${listId}:`, error)
          // Don't fail registration if list membership fails
        }
      }
    }

    console.log(`[OpenClaw Register] Created agent ${agentEmail} (registered by ${auth.user.email})`)

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

  } catch (error) {
    if (error instanceof UnauthorizedError || (error as any)?.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof ForbiddenError || (error as any)?.name === 'ForbiddenError') {
      return NextResponse.json({ error: (error as Error).message }, { status: 403 })
    }
    console.error('[OpenClaw Register] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
