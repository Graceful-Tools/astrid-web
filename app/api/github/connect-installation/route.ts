/**
 * Connect GitHub Installation API
 * Connects a GitHub App installation to the current user
 *
 * Security:
 * - Each installation can only be connected by one user
 * - Only fetches repos from the specific installation being connected
 */

import { BRAND } from '@/lib/brand/config'
import { NextRequest, NextResponse } from 'next/server'
import { getUnifiedSession } from '@/lib/session-utils'
import { prisma } from '@/lib/prisma'
import { App } from '@octokit/app'
import { createLogger } from '@/lib/logger'
import { capabilityGate } from '@/lib/brand/capabilities'

const log = createLogger('github.connect-installation')


export async function POST(request: NextRequest) {
  // A deployment with the GitHub integration disabled must refuse
  // server-side, not merely hide the UI (task 229c175c).
  const capabilityBlocked = capabilityGate('syncGithubIssues')
  if (capabilityBlocked) return capabilityBlocked

  try {
    const session = await getUnifiedSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { installationId } = await request.json()

    if (!installationId) {
      return NextResponse.json(
        { error: 'Installation ID is required' },
        { status: 400 }
      )
    }

    const installationIdInt = parseInt(installationId)

    // Security check: Ensure this installation isn't already connected by another user
    const existingConnection = await prisma.gitHubIntegration.findFirst({
      where: {
        installationId: installationIdInt,
        userId: { not: session.user.id }
      }
    })

    if (existingConnection) {
      return NextResponse.json(
        { error: 'This GitHub installation is already connected to another account' },
        { status: 403 }
      )
    }

    const app = new App({
      appId: parseInt(process.env.GITHUB_APP_ID!),
      privateKey: process.env.GITHUB_APP_PRIVATE_KEY!
    })

    // Fetch repositories ONLY from the specific installation being connected
    let repositories: any[] = []
    try {
      const installationOctokit = await app.getInstallationOctokit(installationIdInt)
      const reposResponse = await installationOctokit.request('GET /installation/repositories')

      // Get installation details for owner info
      const installationDetails = await app.octokit.request('GET /app/installations/{installation_id}', {
        installation_id: installationIdInt
      })

      const account = installationDetails.data.account as any
      repositories = reposResponse.data.repositories.map((repo: any) => ({
        id: repo.id,
        name: repo.name,
        fullName: repo.full_name,
        defaultBranch: repo.default_branch || 'main',
        private: repo.private,
        installationId: installationIdInt,
        owner: account?.login || account?.name || 'unknown'
      }))
    } catch (error: any) {
      if (error.status === 404) {
        return NextResponse.json(
          { error: `Installation not found. Please install the ${BRAND.appName} Agent on GitHub first.` },
          { status: 404 }
        )
      }
      throw error
    }

    // Store the user's GitHub integration (supports multiple installations per user)
    await prisma.gitHubIntegration.upsert({
      where: {
        userId_installationId: {
          userId: session.user.id,
          installationId: installationIdInt
        }
      },
      create: {
        userId: session.user.id,
        installationId: installationIdInt,
        isSharedApp: true,
        repositories
      },
      update: {
        isSharedApp: true,
        repositories
      }
    })

    return NextResponse.json({
      success: true,
      message: `GitHub connected successfully. Found ${repositories.length} repositories.`,
      installationId: installationIdInt,
      repositoryCount: repositories.length
    })

  } catch (error) {
    log.error({ err: error }, 'Error connecting GitHub installation:')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}