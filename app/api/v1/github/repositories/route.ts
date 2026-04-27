/**
 * GitHub Repositories API (v1 - Mobile Compatible)
 * Returns user's accessible GitHub repositories
 *
 * Uses withAuth wrapper for session/OAuth + scope check + standardized errors.
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withAuth } from '@/lib/api-auth-wrapper'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.github.repositories')

export const GET = withAuth(
  { scopes: ['user:read'], tag: 'v1.github.repositories' },
  async (req, auth) => {
    const userId = auth.userId

    const { searchParams } = new URL(req.url)
    const refresh = searchParams.get('refresh') === 'true'

    // Get user's first GitHub integration (for backward compatibility)
    const githubIntegration = await prisma.gitHubIntegration.findFirst({
      where: { userId }
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
        log.debug('Refreshing repositories from GitHub API')

        // Import GitHub client and fetch fresh repositories
        const { GitHubClient } = await import('@/lib/github-client')
        const githubClient = await GitHubClient.forUser(userId)

        // Use the public method to list installation repositories
        const installationRepos = await githubClient.getInstallationRepositories()

        repositories = installationRepos.map((repo) => ({
          id: repo.id,
          name: repo.name,
          fullName: repo.fullName,
          defaultBranch: repo.defaultBranch || 'main',
          private: repo.private || false
        }))

        log.info({ count: repositories.length }, 'Found repositories from GitHub API')

        // Update the cached repositories in database
        if (githubIntegration) {
          await prisma.gitHubIntegration.update({
            where: { id: githubIntegration.id },
            data: {
              repositories: repositories
            }
          })
        }

        log.debug('Updated cached repositories in database')
      } catch (error) {
        log.error({ err: error }, 'Error refreshing repositories from GitHub')
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
  }
)
