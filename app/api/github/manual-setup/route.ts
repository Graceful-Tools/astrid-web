/**
 * Manual GitHub integration setup for local development
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUnifiedSession } from '@/lib/session-utils'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { capabilityGate } from '@/lib/brand/capabilities'

const log = createLogger('github.manual-setup')


export async function POST(request: NextRequest) {
  // A deployment with the GitHub integration disabled must refuse
  // server-side, not merely hide the UI (task 229c175c).
  const capabilityBlocked = capabilityGate('syncGithubIssues')
  if (capabilityBlocked) return capabilityBlocked

  try {
    const session = await getUnifiedSession()
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { installationId, repositories } = await request.json()

    if (!installationId) {
      return NextResponse.json({ error: 'Installation ID required' }, { status: 400 })
    }

    const installationIdInt = parseInt(installationId)

    // Create GitHub integration for testing (supports multiple installations per user)
    const integration = await prisma.gitHubIntegration.upsert({
      where: {
        userId_installationId: {
          userId: session.user.id,
          installationId: installationIdInt
        }
      },
      create: {
        userId: session.user.id,
        installationId: installationIdInt,
        appId: parseInt(process.env.GITHUB_APP_ID!),
        repositories: repositories || [
          {
            id: 123456789,
            name: 'test-repo',
            fullName: 'your-username/test-repo',
            defaultBranch: 'main',
            private: false
          }
        ]
      },
      update: {
        repositories: repositories || [
          {
            id: 123456789,
            name: 'test-repo',
            fullName: 'your-username/test-repo',
            defaultBranch: 'main',
            private: false
          }
        ]
      }
    })

    return NextResponse.json({
      success: true,
      integration: {
        id: integration.id,
        installationId: integration.installationId,
        repositories: integration.repositories
      }
    })

  } catch (error) {
    log.error({ err: error }, 'Error creating manual GitHub integration:')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}