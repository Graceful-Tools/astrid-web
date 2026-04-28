/**
 * Vercel/deployment operations for MCP API
 */

import { getErrorMessage } from "@/lib/error-utils"
import { validateMCPToken } from "./shared"
import { createLogger } from '@/lib/logger'

const log = createLogger('mcp.deployment-operations')


export async function deployToStaging(
  accessToken: string,
  repository: string,
  branch: string,
  commitSha: string | undefined,
  userId: string
) {
  const mcpToken = await validateMCPToken(accessToken)

  // Import VercelClient
  const { VercelClient } = await import('@/lib/vercel-client')

  try {
    const vercelClient = new VercelClient()

    // Deploy the branch to staging
    const result = await vercelClient.deployPRBranch(repository, branch, commitSha)

    if (!result) {
      throw new Error('Failed to create deployment - no Vercel project found')
    }

    return {
      success: true,
      deployment: {
        id: result.deployment.id,
        url: result.deployment.url,
        state: result.deployment.readyState,
        projectId: result.project.id,
        projectName: result.project.name
      },
      message: `Deployment created for ${branch} branch`
    }
  } catch (error: unknown) {
    log.error({ err: error }, `[MCP] Failed to deploy to staging:`)
    throw new Error(`Failed to deploy to staging: ${getErrorMessage(error)}`)
  }
}

export async function getDeploymentStatus(
  accessToken: string,
  deploymentId: string,
  userId: string
) {
  const mcpToken = await validateMCPToken(accessToken)

  const { VercelClient } = await import('@/lib/vercel-client')

  try {
    const vercelClient = new VercelClient()
    const deployment = await vercelClient.getDeployment(deploymentId)

    if (!deployment) {
      throw new Error('Deployment not found')
    }

    return {
      success: true,
      deployment: {
        id: deployment.id,
        url: deployment.url,
        state: deployment.readyState,
        createdAt: deployment.createdAt,
        readyAt: deployment.readyAt
      }
    }
  } catch (error: unknown) {
    log.error({ err: error }, `[MCP] Failed to get deployment status:`)
    throw new Error(`Failed to get deployment status: ${getErrorMessage(error)}`)
  }
}

export async function getDeploymentLogs(
  accessToken: string,
  deploymentId: string,
  userId: string
) {
  const mcpToken = await validateMCPToken(accessToken)

  const { VercelClient } = await import('@/lib/vercel-client')

  try {
    const vercelClient = new VercelClient()
    const logs = await vercelClient.getDeploymentLogs(deploymentId)

    return {
      success: true,
      deploymentId,
      logs: logs || 'No logs available'
    }
  } catch (error: unknown) {
    log.error({ err: error }, `[MCP] Failed to get deployment logs:`)
    throw new Error(`Failed to get deployment logs: ${getErrorMessage(error)}`)
  }
}

export async function getDeploymentErrors(
  accessToken: string,
  deploymentId: string,
  userId: string
) {
  const mcpToken = await validateMCPToken(accessToken)

  const { VercelClient } = await import('@/lib/vercel-client')

  try {
    const vercelClient = new VercelClient()
    const errorInfo = await vercelClient.getDeploymentErrors(deploymentId)

    return {
      success: true,
      deploymentId,
      hasErrors: errorInfo.hasErrors,
      errors: errorInfo.errors,
      buildLogs: errorInfo.buildLogs
    }
  } catch (error: unknown) {
    log.error({ err: error }, `[MCP] Failed to get deployment errors:`)
    throw new Error(`Failed to get deployment errors: ${getErrorMessage(error)}`)
  }
}

export async function listDeployments(
  accessToken: string,
  repository: string,
  branch: string | undefined,
  limit: number = 10,
  userId: string
) {
  const mcpToken = await validateMCPToken(accessToken)

  // Check if Vercel API token is configured (support both env var names)
  if (!process.env.VERCEL_TOKEN && !process.env.VERCEL_API_TOKEN) {
    log.info('[MCP] Vercel API token not configured, returning empty deployments list')
    return {
      success: false,
      error: 'Vercel API not configured',
      message: 'Vercel deployment tracking is not available. Check the PR directly for deployment links.',
      repository,
      branch: branch || 'all',
      deployments: []
    }
  }

  const { VercelClient } = await import('@/lib/vercel-client')

  try {
    const vercelClient = new VercelClient()

    // Get ALL projects to find all linked to this repository
    const response = await fetch(`${vercelClient['baseUrl']}/v9/projects`, {
      headers: vercelClient['getHeaders']()
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch projects: ${response.statusText}`)
    }

    const data = await response.json()
    const allProjects = data.projects || []

    // Find ALL projects that match the GitHub repository
    const matchingProjects = allProjects.filter((p: any) =>
      p.link?.type === 'github' &&
      p.link?.repo === repository
    )

    if (matchingProjects.length === 0) {
      throw new Error(`No Vercel projects found for repository: ${repository}`)
    }

    log.info(matchingProjects.map((p: any) => p.name), `[MCP] Found ${matchingProjects.length} Vercel projects for ${repository}:`)

    // Get deployments from ALL matching projects
    const allDeployments: any[] = []
    for (const project of matchingProjects) {
      const projectDeployments = await vercelClient.listDeployments(project.id, limit * 2)
      allDeployments.push(...projectDeployments.map(d => ({
        ...d,
        projectName: project.name,
        projectId: project.id
      })))
    }

    // Filter by branch if specified
    let deployments = allDeployments
    if (branch) {
      deployments = allDeployments.filter(d => d.meta.githubCommitRef === branch).slice(0, limit * matchingProjects.length)
    } else {
      deployments = allDeployments.slice(0, limit)
    }

    // Sort by creation time (newest first)
    deployments.sort((a, b) => b.createdAt - a.createdAt)

    return {
      success: true,
      repository,
      branch: branch || 'all',
      projectCount: matchingProjects.length,
      projects: matchingProjects.map((p: any) => ({ id: p.id, name: p.name })),
      deployments: deployments.map(d => ({
        id: d.id,
        url: `https://${d.url}`,
        state: d.readyState,
        createdAt: d.createdAt,
        branch: d.meta.githubCommitRef,
        projectName: d.projectName,
        projectId: d.projectId
      }))
    }
  } catch (error: unknown) {
    log.error({ err: error }, `[MCP] Failed to list deployments:`)
    throw new Error(`Failed to list deployments: ${getErrorMessage(error)}`)
  }
}
