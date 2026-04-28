/**
 * GitHub Repositories API
 * Returns user's accessible GitHub repositories
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authConfig } from '@/lib/auth-config'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'

const log = createLogger('github.repositories')


export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authConfig)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const refresh = searchParams.get('refresh') === 'true'

    // Get user's first GitHub integration (for backward compatibility)
    const githubIntegration = await prisma.gitHubIntegration.findFirst({
      where: { userId: session.user.id }
    })

    if (!githubIntegration) {
      return NextResponse.json({
        repositories: [],
        message: 'No GitHub integration found. Please connect your GitHub account first.'
      })
    }

    let repositories: any[] = []

    // If refresh is requested and we have an installation, fetch from GitHub API
    if (refresh && githubIntegration.installationId) {
      try {
        log.info('🔄 Refreshing repositories from GitHub API...')

        // Import GitHub client and fetch fresh repositories
        const { GitHubClient } = await import('@/lib/github-client')
        const githubClient = await GitHubClient.forUser(session.user.id)

        // Use the public method to list installation repositories
        const installationRepos = await githubClient.getInstallationRepositories()

        repositories = installationRepos.map((repo) => ({
          id: repo.id,
          name: repo.name,
          fullName: repo.fullName,
          defaultBranch: repo.defaultBranch || 'main',
          private: repo.private || false
        }))

        log.info(`✅ Found ${repositories.length} repositories from GitHub API`)

        // Update the cached repositories in database
        if (githubIntegration) {
          await prisma.gitHubIntegration.update({
            where: { id: githubIntegration.id },
            data: {
              repositories: repositories
            }
          })
        }

        log.info('✅ Updated cached repositories in database')
      } catch (error) {
        log.error({ err: error }, 'Error refreshing repositories from GitHub:')
        // Fall back to cached repositories if refresh fails
        repositories = Array.isArray(githubIntegration.repositories)
          ? githubIntegration.repositories
          : []
      }
    } else {
      // Use cached repositories
      repositories = Array.isArray(githubIntegration.repositories)
        ? githubIntegration.repositories
        : []
    }

    return NextResponse.json({
      repositories: repositories.map((repo: any) => ({
        id: repo.id,
        name: repo.name,
        fullName: repo.fullName || repo.full_name,
        defaultBranch: repo.defaultBranch || repo.default_branch || 'main',
        private: repo.private || false
      })),
      cached: !refresh,
      lastRefreshed: refresh ? new Date().toISOString() : githubIntegration.updatedAt
    })

  } catch (error) {
    log.error({ err: error }, 'Error fetching GitHub repositories:')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}