/**
 * Rate-limited GraphQL clients for the GitHub Projects backend (AWTD-1151),
 * one per credential the spec allows (§8.6):
 *
 *   forInstallation  hydration, import, reconcile — no user involved
 *   forUser          what THIS user can see or do; GitHub enforces their
 *                    permissions, so Astrid never re-implements them
 *
 * Both spend their own bucket (§8.8): `installation:<id>` or `user:<id>`.
 */

import { getGitHubApp } from './app'
import { githubAppUserTokenFor } from './user-tokens'
import { createGraphqlClient, type GitHubPriority, type GraphqlClient } from './rate-limiter'

export function installationGraphqlClient(installationId: number, priority: GitHubPriority): GraphqlClient {
  return createGraphqlClient({
    bucket: `installation:${installationId}`,
    priority,
    // Octokit caches installation tokens on the shared App, so this is a
    // mint per hour, not per call.
    token: async () => {
      const auth = (await getGitHubApp().octokit.auth({ type: 'installation', installationId })) as { token: string }
      return auth.token
    },
  })
}

/** Null when the user has no usable App token: they must reconnect GitHub. */
export async function userGraphqlClient(userId: string, priority: GitHubPriority): Promise<GraphqlClient | null> {
  const token = await githubAppUserTokenFor(userId)
  if (!token) return null
  return createGraphqlClient({ bucket: `user:${userId}`, priority, token })
}
