/**
 * Listing a user's GitHub repositories — the rule, with no route around it.
 *
 * Shared by `GET /api/github/repositories` and its v1 twin, which were two
 * independent copies with identical logic AND identical responses (v1 adds no
 * `meta` envelope). As with github/status, they stay separate routes because
 * their auth differs — legacy takes a session, v1 enforces a `user:read` scope
 * — and re-exporting would apply that scope check to legacy callers.
 * (Task e0613ae5.)
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'

const log = createLogger('github-repositories')

export interface GitHubRepositorySummary {
  id: unknown
  name: unknown
  fullName: unknown
  defaultBranch: unknown
  private: boolean
}

/**
 * Two genuinely different shapes, not one shape with optional fields. The
 * no-integration response carries `message` and NO `cached`/`lastRefreshed`,
 * exactly as both original routes returned it — adding those fields here would
 * be a silent response-shape change smuggled in under a refactor.
 */
export type ListRepositoriesResult =
  | { repositories: GitHubRepositorySummary[]; message: string }
  | {
      repositories: GitHubRepositorySummary[]
      cached: boolean
      lastRefreshed: string | Date
    }

/**
 * Repositories arrive from two places with different casing: the GitHub API
 * client (camelCase) and whatever was cached on the integration row, which may
 * predate that mapping (snake_case). Normalise both.
 */
function toSummary(repo: Record<string, unknown>): GitHubRepositorySummary {
  return {
    id: repo.id,
    name: repo.name,
    fullName: repo.fullName || repo.full_name,
    defaultBranch: repo.defaultBranch || repo.default_branch || 'main',
    private: Boolean(repo.private) || false,
  }
}

export async function listGitHubRepositories(args: {
  userId: string
  refresh: boolean
}): Promise<ListRepositoriesResult> {
  const { userId, refresh } = args

  // First integration only — kept for backward compatibility with clients that
  // predate multi-org support. (github/status aggregates across all of them.)
  const githubIntegration = await prisma.gitHubIntegration.findFirst({ where: { userId } })

  if (!githubIntegration) {
    return {
      repositories: [],
      message: 'No GitHub integration found. Please connect your GitHub account first.',
    }
  }

  const cached = () =>
    Array.isArray(githubIntegration.repositories)
      ? (githubIntegration.repositories as Record<string, unknown>[])
      : []

  let repositories: Record<string, unknown>[] = []

  if (refresh && githubIntegration.installationId) {
    try {
      const { GitHubClient } = await import('@/lib/github-client')
      const githubClient = await GitHubClient.forUser(userId)
      const installationRepos = await githubClient.getInstallationRepositories()

      repositories = installationRepos.map(repo => ({
        id: repo.id,
        name: repo.name,
        fullName: repo.fullName,
        defaultBranch: repo.defaultBranch || 'main',
        private: repo.private || false,
      }))

      await prisma.gitHubIntegration.update({
        where: { id: githubIntegration.id },
        // `repositories` is a Json column; Prisma's input type does not accept
        // a plain Record[]. The originals slipped past this only by typing the
        // array as `any`.
        data: { repositories: repositories as Prisma.InputJsonValue },
      })

      log.info({ count: repositories.length, userId }, 'Refreshed repositories from GitHub')
    } catch (error) {
      // A failed refresh must degrade to the cache, not to an error: the user
      // asked for fresher data, not for the list to disappear.
      log.error({ err: error, userId }, 'Error refreshing repositories from GitHub')
      repositories = cached()
    }
  } else {
    repositories = cached()
  }

  return {
    repositories: repositories.map(toSummary),
    cached: !refresh,
    lastRefreshed: refresh ? new Date().toISOString() : githubIntegration.updatedAt,
  }
}
