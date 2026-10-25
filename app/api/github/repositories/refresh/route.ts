/**
 * GitHub Repositories Refresh API
 * Refreshes repositories from ALL user's GitHub installations
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUnifiedSession } from '@/lib/session-utils'
import { prisma } from '@/lib/prisma'
import { getGitHubApp } from '@/lib/github/app'
import { createLogger } from '@/lib/logger'
import { capabilityGate } from '@/lib/brand/capabilities'
import { recordInstallation, replaceInstallationRepos } from '@/lib/github/installations'

const log = createLogger('github.repositories.refresh')


export async function POST(request: NextRequest) {
  // A deployment without the coding agent must refuse
  // server-side, not merely hide the UI (task 229c175c).
  const capabilityBlocked = capabilityGate('codingAgent')
  if (capabilityBlocked) return capabilityBlocked

  try {
    const session = await getUnifiedSession()
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

    const app = getGitHubApp()

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
        // …and in the installation model the coding agent resolves repos from
        // (AWTD-1111). Best effort: the fresh list is already in hand.
        try {
          await recordInstallation({
            installationId: integration.installationId,
            account: { login: owner, type: account?.type ?? null, nodeId: account?.node_id ?? null },
            repositorySelection: (installationDetails.data as any).repository_selection ?? null,
          })
          await replaceInstallationRepos(
            integration.installationId,
            reposResponse.data.repositories.map((repo: any) => ({
              id: repo.id,
              fullName: repo.full_name,
              defaultBranch: repo.default_branch,
              private: repo.private,
              nodeId: repo.node_id,
            }))
          )
        } catch (err) {
          log.error({ err, installationId: integration.installationId }, 'Failed to record refreshed repos in the installation model')
        }

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
