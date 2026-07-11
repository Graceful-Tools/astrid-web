/**
 * GitHub Integration API endpoints
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUnifiedSession } from '@/lib/session-utils'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'

const log = createLogger('github.integration')


export async function GET(request: NextRequest) {
  try {
    const session = await getUnifiedSession()
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get ALL integrations for this user
    const integrations = await prisma.gitHubIntegration.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: 'asc' }
    })

    if (integrations.length === 0) {
      return NextResponse.json({ integration: null }, { status: 404 })
    }

    // Aggregate repositories from all integrations
    const allRepositories: any[] = []
    const installationIds: number[] = []

    for (const integration of integrations) {
      if (integration.installationId) {
        installationIds.push(integration.installationId)
      }
      const repos = (integration.repositories as any[]) || []
      // Add installationId to each repo so we know which installation it came from
      for (const repo of repos) {
        allRepositories.push({
          ...repo,
          installationId: integration.installationId
        })
      }
    }

    // Return aggregated data with backward-compatible structure
    // Use the first integration's ID and connectedAt for backward compatibility
    const firstIntegration = integrations[0]

    return NextResponse.json({
      integration: {
        id: firstIntegration.id,
        installationId: firstIntegration.installationId,
        repositories: allRepositories,
        connectedAt: firstIntegration.createdAt,
        // Additional fields for multi-installation support
        installationIds,
        integrationCount: integrations.length
      }
    })

  } catch (error) {
    log.error({ err: error }, 'Error getting GitHub integration:')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getUnifiedSession()
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Delete all user's integrations
    await prisma.gitHubIntegration.deleteMany({
      where: { userId: session.user.id }
    })

    return NextResponse.json({ success: true })

  } catch (error) {
    log.error({ err: error }, 'Error deleting GitHub integration:')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}