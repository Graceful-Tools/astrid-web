/**
 * GitHub App setup handler for post-installation
 * Called by GitHub after user installs the app
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUnifiedSession } from '@/lib/session-utils'
import { prisma } from '@/lib/prisma'
import { App } from '@octokit/app'
import { createLogger } from '@/lib/logger'
import { capabilityGate } from '@/lib/brand/capabilities'

const log = createLogger('github.setup')


export async function GET(request: NextRequest) {
  // A deployment with the GitHub integration disabled must refuse
  // server-side, not merely hide the UI (task 229c175c).
  const capabilityBlocked = capabilityGate('syncGithubIssues')
  if (capabilityBlocked) return capabilityBlocked

  try {
    const { searchParams } = new URL(request.url)
    const installationId = searchParams.get('installation_id')
    const setupAction = searchParams.get('setup_action')

    // Get session
    const session = await getUnifiedSession()
    if (!session?.user) {
      return NextResponse.redirect(new URL('/auth/signin', request.url))
    }

    if ((setupAction === 'install' || setupAction === 'update') && installationId) {
      const installationIdInt = parseInt(installationId)
      const userId = session.user.id

      // Security check: Ensure this installation isn't already connected by another user
      const existingConnection = await prisma.gitHubIntegration.findFirst({
        where: {
          installationId: installationIdInt,
          userId: { not: userId }
        }
      })

      if (existingConnection) {
        log.info(`⚠️ Installation ${installationId} already connected to another user`)
        return NextResponse.redirect(
          new URL('/settings/agents?github=already_connected', request.url)
        )
      }

      // Fetch repositories from this installation
      let repositories: any[] = []
      if (process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY) {
        try {
          const app = new App({
            appId: parseInt(process.env.GITHUB_APP_ID),
            privateKey: process.env.GITHUB_APP_PRIVATE_KEY
          })

          const installationOctokit = await app.getInstallationOctokit(installationIdInt)
          const reposResponse = await installationOctokit.request('GET /installation/repositories')

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
        } catch (error) {
          log.error({ err: error }, 'Error fetching repositories:')
          // Continue without repos - they can be fetched later
        }
      }

      // Create or update GitHub integration (supports multiple installations per user)
      await prisma.gitHubIntegration.upsert({
        where: {
          userId_installationId: {
            userId,
            installationId: installationIdInt
          }
        },
        create: {
          userId,
          installationId: installationIdInt,
          appId: process.env.GITHUB_APP_ID ? parseInt(process.env.GITHUB_APP_ID) : null,
          isSharedApp: true,
          repositories
        },
        update: {
          appId: process.env.GITHUB_APP_ID ? parseInt(process.env.GITHUB_APP_ID) : null,
          isSharedApp: true,
          repositories
        }
      })

      log.info(`✅ GitHub App ${setupAction}ed for user ${userId}, installation ${installationId}, ${repositories.length} repos`)

      // Redirect to the agents settings page with success message
      return NextResponse.redirect(
        new URL(`/settings/agents?github=${setupAction === 'install' ? 'connected' : 'updated'}`, request.url)
      )
    }

    // Default redirect to settings
    return NextResponse.redirect(new URL('/settings/agents', request.url))

  } catch (error) {
    log.error({ err: error }, 'Error handling GitHub setup:')
    return NextResponse.redirect(
      new URL('/settings/agents?github=error', request.url)
    )
  }
}