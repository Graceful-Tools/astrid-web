/**
 * GitHub Connection Status API (v1 - Mobile Compatible)
 * Checks if user has complete GitHub + AI setup
 *
 * Uses authenticateAPI middleware to support both OAuth and session cookies
 */

import { type NextRequest, NextResponse } from 'next/server'
import { authenticateAPI, requireScopes } from '@/lib/api-auth-middleware'
import { prisma } from '@/lib/prisma'
import { MCPSettingsSchema, parseUserAIConfig } from '@/lib/ai/user-config-schemas'

export async function GET(req: NextRequest) {
  try {
    // Use API authentication (supports both OAuth and session cookies)
    const auth = await authenticateAPI(req)
    requireScopes(auth, ['user:read'])

    const userId = auth.userId

    // Fetch ALL GitHub integrations — users may have connected multiple orgs.
    // Previously we used findFirst, which silently hid additional installations
    // from iOS clients (the legacy /api/github/status endpoint already
    // aggregated correctly, so this matches that behavior).
    const githubIntegrations = await prisma.gitHubIntegration.findMany({
      where: { userId }
    })

    // Check if user has AI API keys configured
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { mcpSettings: true }
    })

    const mcpSettings = parseUserAIConfig(user?.mcpSettings, MCPSettingsSchema, 'v1/github/status')
    const apiKeys = mcpSettings.apiKeys || {}
    const configuredProviders = Object.keys(apiKeys).filter(provider =>
      apiKeys[provider]?.encrypted && ['claude', 'openai', 'gemini'].includes(provider)
    )

    // Check if user has MCP tokens
    const mcpTokens = await prisma.mCPToken.findMany({
      where: { userId }
    })

    // Aggregate data from all integrations (parity with /api/github/status).
    const connectedInstallationIds: number[] = []
    const allRepositories: any[] = []
    for (const integration of githubIntegrations) {
      if (integration.installationId) {
        connectedInstallationIds.push(integration.installationId)
      }
      const repos = (integration.repositories as any[]) || []
      allRepositories.push(...repos)
    }

    const isGitHubConnected = connectedInstallationIds.length > 0
    const hasAIKeys = configuredProviders.length > 0
    const hasMCPToken = mcpTokens.length > 0
    const repositoryCount = allRepositories.length

    // For coding workflows (GitHub connected), all agents are available via worker's API keys
    // For non-coding workflows (no GitHub), only user's configured API keys work
    const availableProviders = isGitHubConnected
      ? ['claude', 'openai', 'gemini'] // Worker has all provider keys
      : configuredProviders // User's personal API keys

    console.log('🔍 [GitHub Status v1] Checking status for user:', userId)
    console.log('  - GitHub connected:', isGitHubConnected, `(${connectedInstallationIds.length} installations)`)
    console.log('  - User API keys:', configuredProviders)
    console.log('  - Available providers:', availableProviders)

    return NextResponse.json({
      isGitHubConnected,
      hasAIKeys,
      hasMCPToken,
      repositoryCount,
      mcpTokenCount: mcpTokens.length,
      isFullyConfigured: isGitHubConnected && hasMCPToken,
      githubIntegration: isGitHubConnected ? {
        // Primary installation kept for backward compatibility with existing clients.
        installationId: connectedInstallationIds[0],
        repositoryCount,
        // Additive: full repo + installation list (parity with /api/github/status).
        repositories: allRepositories,
        connectedInstallationIds,
      } : null,
      installationCount: connectedInstallationIds.length,
      aiProviders: availableProviders,
      userApiKeys: configuredProviders // User's own configured keys (for non-coding)
    })

  } catch (error) {
    console.error('[GitHub Status v1] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
