/**
 * GitHub Repositories Refresh API
 * Refreshes repositories from ALL user's GitHub installations
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authConfig } from '@/lib/auth-config'
import { prisma } from '@/lib/prisma'
import { App } from '@octokit/app'
import { createLogger } from '@/lib/logger'

const log = createLogger('github.repositories.refresh')


export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authConfig)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get ALL user's GitHub integrations
    const integrations = await prisma.gitHubIntegration.findMany({
      where: { userId: session.user.id }
    })

    if (integrations.length === 0) {
      return NextResponse.json({
        repositories: [],
        message: 'No GitHub integrations found. Please connect your GitHub account first.'
      })
    }

    // Check if GitHub App is configured
    if (!process.env.GITHUB_APP_ID || !process.env.GITHUB_APP_PRIVATE_KEY) {
      return NextResponse.json(
        { error: 'GitHub App not configured on server' },
        { status: 500 }
      )
    }

    const app = new App({
      appId: parseInt(process.env.GITHUB_APP_ID),
      privateKey: process.env.GITHUB_APP_PRIVATE_KEY
    })

    const allRepositories: any[] = []
    const errors: string[] = []

    // Refresh repositories for each integration
    for (const integration of integrations) {
      if (!integration.installationId) {
        log.info(`⚠️ Skipping integration ${integration.id} - no installationId`)
        continue
      }

      try {
        log.info(`🔄 Refreshing repositories for installation ${integration.installationId}...`)

        const installationOctokit = await app.getInstallationOctokit(integration.installationId)
        const reposResponse = await installationOctokit.request('GET /installation/repositories')

        // Get installation details for owner info
        const installationDetails = await app.octokit.request('GET /app/installations/{installation_id}', {
          installation_id: integration.installationId
        })

        const account = installationDetails.data.account as any
        const owner = account?.login || account?.name || 'unknown'

        const repositories = reposResponse.data.repositories.map((repo: any) => ({
          id: repo.id,
          name: repo.name,
          fullName: repo.full_name,
          defaultBranch: repo.default_branch || 'main',
          private: repo.private,
          installationId: integration.installationId,
          owner
        }))

        // Update cached repositories in database for this integration
        await prisma.gitHubIntegration.update({
          where: { id: integration.id },
          data: { repositories }
        })

        log.info(`✅ Found ${repositories.length} repositories for installation ${integration.installationId} (${owner})`)

        // Add to aggregated list
        allRepositories.push(...repositories)

      } catch (error) {
        const errorMessage = `Failed to refresh installation ${integration.installationId}: ${error}`
        log.error(`❌ ${errorMessage}`)
        errors.push(errorMessage)

        // Still include cached repositories if refresh fails
        const cachedRepos = (integration.repositories as any[]) || []
        allRepositories.push(...cachedRepos.map(repo => ({
          ...repo,
          installationId: integration.installationId
        })))
      }
    }

    return NextResponse.json({
      repositories: allRepositories,
      refreshedAt: new Date().toISOString(),
      integrationCount: integrations.length,
      repositoryCount: allRepositories.length,
      errors: errors.length > 0 ? errors : undefined
    })

  } catch (error) {
    log.error({ err: error }, 'Error refreshing GitHub repositories:')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
