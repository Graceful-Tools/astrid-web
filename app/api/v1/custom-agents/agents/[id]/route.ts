/**
 * PATCH /api/v1/custom-agents/agents/:id - Update a Custom Agent profile
 * DELETE /api/v1/custom-agents/agents/:id - Remove a Custom Agent
 *
 * Auth: session (owner only)
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { AIAgentConfigSchema, parseUserAIConfig } from '@/lib/ai/user-config-schemas'
import { withAuth } from '@/lib/api-auth-wrapper'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.custom-agents.agents.id')

type RouteContext = { params: Promise<{ id: string }> }

export const PATCH = withAuth<RouteContext>(
  { tag: 'v1.custom-agents.agents.id', capability: 'integrationCustomAgents' },
  async (req, auth, { params }) => {
    const { id } = await params

    const agent = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, image: true, aiAgentType: true, aiAgentConfig: true },
    })

    if (!agent || agent.aiAgentType !== 'openclaw_worker') {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const config = parseUserAIConfig(
      agent.aiAgentConfig as string | null | undefined,
      AIAgentConfigSchema,
      'v1/custom-agents/agents/[id] PATCH ownership'
    )

    if (config.registeredBy !== auth.userId) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const body = await req.json()
    const { image } = body

    if (image !== undefined) {
      const newImage = image || '/images/ai-agents/openclaw.svg'
      await prisma.user.update({
        where: { id },
        data: { image: newImage },
      })

      log.info(
        { agentEmail: agent.email, updatedBy: auth.user.email },
        'Updated agent profile photo'
      )

      return NextResponse.json({ success: true, image: newImage })
    }

    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }
)

export const DELETE = withAuth<RouteContext>(
  { tag: 'v1.custom-agents.agents.id', capability: 'integrationCustomAgents' },
  async (_req, auth, { params }) => {
    const { id } = await params

    const agent = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, aiAgentType: true, aiAgentConfig: true },
    })

    if (!agent || agent.aiAgentType !== 'openclaw_worker') {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const config = parseUserAIConfig(
      agent.aiAgentConfig as string | null | undefined,
      AIAgentConfigSchema,
      'v1/custom-agents/agents/[id] DELETE ownership'
    )

    if (config.registeredBy !== auth.userId) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    // Delete user — cascades to OAuthClient and OAuthToken
    await prisma.user.delete({ where: { id } })

    log.info(
      { agentEmail: agent.email, deletedBy: auth.user.email },
      'Deleted Custom Agent'
    )

    return NextResponse.json({ success: true })
  }
)
