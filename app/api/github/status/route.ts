/**
 * GitHub Connection Status API
 * Checks if user has complete GitHub + AI setup
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authConfig } from '@/lib/auth-config'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'

const log = createLogger('github.status')


export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authConfig)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check GitHub integrations (user may have multiple)
    const githubIntegrations = await prisma.gitHubIntegration.findMany({
      where: { userId: session.user.id }
    })

    // Check if user has AI API keys configured
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { mcpSettings: true }
    })

    const mcpSettings = user?.mcpSettings ? (typeof user.mcpSettings === 'string' ? JSON.parse(user.mcpSettings) : user.mcpSettings) : {}
    const apiKeys = mcpSettings.apiKeys || {}
    const configuredProviders = Object.keys(apiKeys).filter(provider =>
      apiKeys[provider]?.encrypted && ['claude', 'openai', 'gemini'].includes(provider)
    )

    // Check if user has MCP tokens
    const mcpTokens = await prisma.mCPToken.findMany({
      where: { userId: session.user.id }
    })

    // Aggregate data from all integrations
    const connectedInstallationIds: number[] = []
    const allRepositories: any[] = []

    for (const integration of githubIntegrations) {
      if (integration.installationId) {
        connectedInstallationIds.push(integration.installationId)
      }
      const repos = integration.repositories as any[] || []
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

    log.info({ userId: session.user.id }, '🔍 [GitHub Status] Checking status for user')
    log.info({ isGitHubConnected }, '  - GitHub connected:')
    log.info({ configuredProviders }, '  - User API keys:')
    log.info({ availableProviders }, '  - Available providers:')

    return NextResponse.json({
      isGitHubConnected,
      hasAIKeys,
      hasMCPToken,
      repositoryCount,
      mcpTokenCount: mcpTokens.length,
      isFullyConfigured: isGitHubConnected && hasMCPToken,
      githubIntegration: isGitHubConnected ? {
        installationId: connectedInstallationIds[0], // Primary installation for backward compatibility
        repositoryCount,
        repositories: allRepositories, // Include repos so UI can check which installations are connected
        connectedInstallationIds // List of all connected installation IDs
      } : null,
      installationCount: connectedInstallationIds.length,
      aiProviders: availableProviders,
      userApiKeys: configuredProviders // User's own configured keys (for non-coding)
    })

  } catch (error) {
    log.error({ err: error }, 'Error checking GitHub status:')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}