/**
 * The GitHub + AI setup status payload, with no route around it.
 *
 * Shared by `GET /api/github/status` and its v1 twin, which were two
 * independent copies. This pair is unusual among the 28: the two responses are
 * **identical** — v1 adds no `meta` envelope here — so it is the one shape
 * where a straight re-export would almost work.
 *
 * It is still an extraction rather than a re-export, because the auth is not
 * interchangeable. Legacy takes a session; v1 goes through `withAuth` with a
 * `user:read` scope. Making legacy re-export v1 would quietly subject legacy
 * OAuth callers to a scope check they have never had, which is an
 * authorization change smuggled in as a refactor.
 *
 * Where the copies differed, this takes v1's version: legacy hand-rolled
 * `JSON.parse(mcpSettings)`, which throws on malformed stored settings and
 * turns a status check into a 500. v1 validates through `parseUserAIConfig`.
 * (Task e0613ae5.)
 */

import { prisma } from '@/lib/prisma'
import { hasCopilotCredential } from '@/lib/copilot/oauth'
import { MCPSettingsSchema, parseUserAIConfig } from '@/lib/ai/user-config-schemas'

/** Providers a user can hold their own API key for. */
const KEYED_PROVIDERS = ['claude', 'openai', 'gemini'] as const

export interface GitHubStatus {
  isGitHubConnected: boolean
  hasAIKeys: boolean
  hasMCPToken: boolean
  repositoryCount: number
  mcpTokenCount: number
  isFullyConfigured: boolean
  githubIntegration: {
    installationId: number | undefined
    repositoryCount: number
    repositories: unknown[]
    connectedInstallationIds: number[]
  } | null
  installationCount: number
  aiProviders: string[]
  userApiKeys: string[]
}

export async function getGitHubStatus(userId: string, tag: string): Promise<GitHubStatus> {
  // A user may have connected multiple orgs; findFirst would silently hide all
  // but one installation.
  const githubIntegrations = await prisma.gitHubIntegration.findMany({ where: { userId } })

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { mcpSettings: true },
  })

  const mcpSettings = parseUserAIConfig(user?.mcpSettings, MCPSettingsSchema, tag)
  const apiKeys = mcpSettings.apiKeys || {}
  const configuredProviders = Object.keys(apiKeys).filter(
    provider =>
      apiKeys[provider]?.encrypted &&
      (KEYED_PROVIDERS as readonly string[]).includes(provider),
  )

  // Copilot authenticates via GitHub OAuth, so its credential lives in
  // CopilotCredential rather than mcpSettings.apiKeys and must be checked
  // separately — same as lib/ai/orchestrator/factory.ts does.
  if (await hasCopilotCredential(userId)) configuredProviders.push('copilot')

  const mcpTokens = await prisma.mCPToken.findMany({ where: { userId } })

  const connectedInstallationIds: number[] = []
  const allRepositories: unknown[] = []
  for (const integration of githubIntegrations) {
    if (integration.installationId) {
      connectedInstallationIds.push(integration.installationId)
    }
    const repos = (integration.repositories as unknown[]) || []
    allRepositories.push(...repos)
  }

  const isGitHubConnected = connectedInstallationIds.length > 0
  const hasMCPToken = mcpTokens.length > 0
  const repositoryCount = allRepositories.length

  // With GitHub connected, coding workflows run on the worker's provider keys,
  // so every provider is available regardless of the user's own keys. Copilot
  // is the exception: it is per-user OAuth, so it only appears if this user has
  // it.
  const availableProviders = isGitHubConnected
    ? [
        ...KEYED_PROVIDERS,
        ...(configuredProviders.includes('copilot') ? ['copilot'] : []),
      ]
    : configuredProviders

  return {
    isGitHubConnected,
    hasAIKeys: configuredProviders.length > 0,
    hasMCPToken,
    repositoryCount,
    mcpTokenCount: mcpTokens.length,
    isFullyConfigured: isGitHubConnected && hasMCPToken,
    githubIntegration: isGitHubConnected
      ? {
          // Primary installation, kept for backward compatibility.
          installationId: connectedInstallationIds[0],
          repositoryCount,
          repositories: allRepositories,
          connectedInstallationIds,
        }
      : null,
    installationCount: connectedInstallationIds.length,
    aiProviders: availableProviders,
    userApiKeys: configuredProviders,
  }
}
