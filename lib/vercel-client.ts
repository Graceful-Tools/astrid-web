import { createLogger } from '@/lib/logger'

const log = createLogger('vercel-client')

/**
 * Vercel API Client for staging deployments
 * Handles deployment creation and status monitoring for GitHub PRs
 */

export interface VercelDeployment {
  id: string
  url: string
  state: 'BUILDING' | 'READY' | 'ERROR' | 'CANCELED'
  readyState: 'QUEUED' | 'BUILDING' | 'READY' | 'ERROR' | 'CANCELED'
  createdAt: number
  buildingAt?: number
  readyAt?: number
  target: 'staging' | 'production' | 'preview'
  source: 'git'
  projectId: string
  meta: {
    githubCommitSha: string
    githubCommitRef: string
    githubCommitRepo: string
    githubCommitOrg: string
  }
}

export interface VercelProject {
  id: string
  name: string
  accountId: string
  framework: string | null
  devCommand: string | null
  buildCommand: string | null
  outputDirectory: string | null
  installCommand: string | null
  gitRepository?: {
    type: 'github'
    repo: string
  }
}

export class VercelClient {
  private apiToken: string
  private teamId?: string
  private baseUrl = 'https://api.vercel.com'

  constructor() {
    // Support both VERCEL_TOKEN (GitHub) and VERCEL_API_TOKEN (legacy)
    this.apiToken = process.env.VERCEL_TOKEN || process.env.VERCEL_API_TOKEN || ''
    this.teamId = process.env.VERCEL_TEAM_ID

    if (!this.apiToken) {
      throw new Error('VERCEL_TOKEN or VERCEL_API_TOKEN environment variable is required')
    }
  }

  /**
   * Get headers for Vercel API requests
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.apiToken}`,
      'Content-Type': 'application/json'
    }

    if (this.teamId) {
      headers['X-Vercel-Team-Id'] = this.teamId
    }

    return headers
  }

  /**
   * Find project by GitHub repository
   */
  async findProjectByRepo(repoFullName: string): Promise<VercelProject | null> {
    try {
      const response = await fetch(`${this.baseUrl}/v9/projects`, {
        headers: this.getHeaders()
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch projects: ${response.statusText}`)
      }

      const data = await response.json()
      const projects = data.projects || []

      // Find project that matches the GitHub repository
      const project = projects.find((p: any) =>
        p.link?.type === 'github' &&
        p.link?.repo === repoFullName
      )

      if (!project) {
        log.info(`⚠️ No Vercel project found for repository: ${repoFullName}`)
        log.info('💡 To enable preview deployments:')
        log.info('   1. Import your project at https://vercel.com/new')
        log.info('   2. Ensure the GitHub repository is linked to the Vercel project')
        log.info('   3. Verify VERCEL_TOKEN and VERCEL_TEAM_ID environment variables are set')
        return null
      }

      return {
        id: project.id,
        name: project.name,
        accountId: project.accountId,
        framework: project.framework,
        devCommand: project.devCommand,
        buildCommand: project.buildCommand,
        outputDirectory: project.outputDirectory,
        installCommand: project.installCommand,
        gitRepository: {
          type: 'github',
          repo: repoFullName
        }
      }
    } catch (error) {
      log.error({ err: error }, 'Error finding Vercel project:')
      return null
    }
  }

  /**
   * Create a new deployment for a specific git branch/commit
   */
  async createDeployment(
    projectId: string,
    options: {
      gitSource: {
        type: 'github'
        repo: string
        ref: string // branch name or commit SHA
      }
      target?: 'staging' | 'preview'
      meta?: Record<string, string>
    }
  ): Promise<VercelDeployment | null> {
    try {
      const payload = {
        name: `${options.gitSource.repo.split('/')[1]}-${options.gitSource.ref}`,
        gitSource: options.gitSource,
        target: options.target || 'preview',
        projectSettings: {
          framework: null,
          devCommand: null,
          buildCommand: null,
          outputDirectory: null,
          installCommand: null
        },
        meta: {
          githubCommitRef: options.gitSource.ref,
          githubCommitRepo: options.gitSource.repo,
          githubCommitOrg: options.gitSource.repo.split('/')[0],
          ...options.meta
        }
      }

      log.info({
        projectId,
        repo: options.gitSource.repo,
        ref: options.gitSource.ref,
        target: options.target
      }, '🚀 [Vercel] Creating deployment:')

      const response = await fetch(`${this.baseUrl}/v13/deployments`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(payload)
      })

      if (!response.ok) {
        const errorText = await response.text()
        log.error({ status: response.status, errorText }, 'Vercel API Error')
        throw new Error(`Failed to create deployment: ${response.statusText}`)
      }

      const deployment = await response.json()

      log.info({
        id: deployment.id,
        url: deployment.url,
        state: deployment.readyState
      }, '✅ [Vercel] Deployment created:')

      return {
        id: deployment.id,
        url: `https://${deployment.url}`,
        state: deployment.readyState,
        readyState: deployment.readyState,
        createdAt: deployment.createdAt,
        buildingAt: deployment.buildingAt,
        readyAt: deployment.readyAt,
        target: deployment.target,
        source: 'git',
        projectId,
        meta: {
          githubCommitSha: deployment.meta?.githubCommitSha || options.gitSource.ref,
          githubCommitRef: deployment.meta?.githubCommitRef || options.gitSource.ref,
          githubCommitRepo: deployment.meta?.githubCommitRepo || options.gitSource.repo,
          githubCommitOrg: deployment.meta?.githubCommitOrg || options.gitSource.repo.split('/')[0]
        }
      }
    } catch (error) {
      log.error({ err: error }, 'Error creating Vercel deployment:')
      return null
    }
  }

  /**
   * Get deployment status
   */
  async getDeployment(deploymentId: string): Promise<VercelDeployment | null> {
    try {
      const response = await fetch(`${this.baseUrl}/v13/deployments/${deploymentId}`, {
        headers: this.getHeaders()
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch deployment: ${response.statusText}`)
      }

      const deployment = await response.json()

      return {
        id: deployment.id,
        url: `https://${deployment.url}`,
        state: deployment.readyState,
        readyState: deployment.readyState,
        createdAt: deployment.createdAt,
        buildingAt: deployment.buildingAt,
        readyAt: deployment.readyAt,
        target: deployment.target,
        source: 'git',
        projectId: deployment.projectId,
        meta: {
          githubCommitSha: deployment.meta?.githubCommitSha || '',
          githubCommitRef: deployment.meta?.githubCommitRef || '',
          githubCommitRepo: deployment.meta?.githubCommitRepo || '',
          githubCommitOrg: deployment.meta?.githubCommitOrg || ''
        }
      }
    } catch (error) {
      log.error({ err: error }, 'Error fetching deployment:')
      return null
    }
  }

  /**
   * Wait for deployment to be ready
   */
  async waitForDeployment(
    deploymentId: string,
    timeoutMs: number = 300000 // 5 minutes
  ): Promise<VercelDeployment | null> {
    const startTime = Date.now()

    while (Date.now() - startTime < timeoutMs) {
      const deployment = await this.getDeployment(deploymentId)

      if (!deployment) {
        return null
      }

      if (deployment.readyState === 'READY') {
        return deployment
      }

      if (deployment.readyState === 'ERROR' || deployment.readyState === 'CANCELED') {
        throw new Error(`Deployment failed with state: ${deployment.readyState}`)
      }

      // Wait 10 seconds before checking again
      await new Promise(resolve => setTimeout(resolve, 10000))
    }

    throw new Error('Deployment timed out')
  }

  /**
   * Create deployment for GitHub PR branch
   */
  async deployPRBranch(
    repoFullName: string,
    branchName: string,
    commitSha?: string
  ): Promise<{
    deployment: VercelDeployment
    project: VercelProject
  } | null> {
    try {
      // Find the Vercel project for this repository
      const project = await this.findProjectByRepo(repoFullName)

      if (!project) {
        log.info(`⚠️ No Vercel project configured for ${repoFullName}`)
        log.info('💡 Preview URLs will not be available. See instructions above for setup.')
        return null
      }

      // Create deployment for the branch
      const deployment = await this.createDeployment(project.id, {
        gitSource: {
          type: 'github',
          repo: repoFullName,
          ref: commitSha || branchName
        },
        target: 'preview',
        meta: {
          branchName,
          commitSha: commitSha || branchName,
          purpose: 'astrid-code-assistant-preview'
        }
      })

      if (!deployment) {
        return null
      }

      return { deployment, project }
    } catch (error) {
      log.error({ err: error }, 'Error deploying PR branch:')
      return null
    }
  }

  /**
   * Get deployment build logs - crucial for debugging deployment issues
   */
  async getDeploymentLogs(deploymentId: string): Promise<string | null> {
    try {
      const response = await fetch(
        `${this.baseUrl}/v2/deployments/${deploymentId}/events`,
        {
          headers: this.getHeaders()
        }
      )

      if (!response.ok) {
        throw new Error(`Failed to fetch deployment logs: ${response.statusText}`)
      }

      const lines = (await response.text()).split('\n')
      const logs: string[] = []

      for (const line of lines) {
        if (!line.trim()) continue

        try {
          const event = JSON.parse(line)

          // Extract relevant log information
          if (event.type === 'stdout' || event.type === 'stderr') {
            logs.push(`[${event.type}] ${event.payload?.text || event.text || ''}`)
          } else if (event.type === 'error') {
            logs.push(`[ERROR] ${event.payload?.message || event.text || JSON.stringify(event)}`)
          } else if (event.type === 'command') {
            logs.push(`[COMMAND] ${event.payload || event.text || ''}`)
          } else if (event.type === 'build-step') {
            logs.push(`[BUILD] ${event.payload || event.text || ''}`)
          }
        } catch (parseError) {
          // Skip lines that aren't JSON
          continue
        }
      }

      return logs.join('\n')
    } catch (error) {
      log.error({ err: error }, 'Error fetching deployment logs:')
      return null
    }
  }

  /**
   * Get deployment runtime logs - for debugging running applications
   */
  async getRuntimeLogs(deploymentId: string, limit: number = 100): Promise<string | null> {
    try {
      const response = await fetch(
        `${this.baseUrl}/v2/deployments/${deploymentId}/events?limit=${limit}`,
        {
          headers: this.getHeaders()
        }
      )

      if (!response.ok) {
        throw new Error(`Failed to fetch runtime logs: ${response.statusText}`)
      }

      const data = await response.json()
      const logs: string[] = []

      // Process log entries
      if (data.logs) {
        for (const log of data.logs) {
          const timestamp = new Date(log.timestamp).toISOString()
          logs.push(`[${timestamp}] ${log.message || log.text || ''}`)
        }
      }

      return logs.join('\n')
    } catch (error) {
      log.error({ err: error }, 'Error fetching runtime logs:')
      return null
    }
  }

  /**
   * Check if deployment has any errors
   */
  async getDeploymentErrors(deploymentId: string): Promise<{
    hasErrors: boolean
    errors: string[]
    buildLogs?: string
  }> {
    try {
      const deployment = await this.getDeployment(deploymentId)
      const logs = await this.getDeploymentLogs(deploymentId)

      const errors: string[] = []

      // Check deployment state
      if (deployment?.readyState === 'ERROR') {
        errors.push(`Deployment failed with state: ERROR`)
      }

      // Extract errors from logs
      if (logs) {
        const errorLines = logs.split('\n').filter(line =>
          line.includes('[ERROR]') ||
          line.includes('Error:') ||
          line.includes('Failed') ||
          line.toLowerCase().includes('error')
        )
        errors.push(...errorLines)
      }

      return {
        hasErrors: errors.length > 0 || deployment?.readyState === 'ERROR',
        errors,
        buildLogs: logs || undefined
      }
    } catch (error) {
      log.error({ err: error }, 'Error checking deployment errors:')
      return {
        hasErrors: true,
        errors: [error instanceof Error ? error.message : 'Unknown error checking deployment']
      }
    }
  }

  /**
   * Create an alias for a deployment to a custom domain
   * Used to create *.astrid.cc subdomains for staging previews
   */
  async aliasDeployment(
    deploymentUrl: string,
    aliasHostname: string
  ): Promise<{ success: boolean; aliasUrl?: string; error?: string }> {
    try {
      // Extract deployment ID from URL (e.g., "https://xxx-yyy.vercel.app" -> use full URL)
      // The Vercel API accepts either deployment ID or full URL
      const deploymentId = deploymentUrl.replace('https://', '').replace('http://', '')

      log.info(`🔗 Creating alias: ${aliasHostname} -> ${deploymentUrl}`)

      const response = await fetch(`${this.baseUrl}/v2/deployments/${deploymentId}/aliases`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ alias: aliasHostname })
      })

      if (!response.ok) {
        const errorData = await response.text()
        log.error({ status: response.status, errorData }, 'Vercel alias API error')
        return { success: false, error: `Failed to create alias: ${response.statusText}` }
      }

      const data = await response.json()
      const aliasUrl = `https://${aliasHostname}`

      log.info(`✅ Alias created: ${aliasUrl}`)
      return { success: true, aliasUrl }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      log.error({ err: errorMessage }, 'Error creating Vercel alias:')
      return { success: false, error: errorMessage }
    }
  }

  /**
   * List deployments for a project
   */
  async listDeployments(projectId: string, limit: number = 10): Promise<VercelDeployment[]> {
    try {
      const response = await fetch(
        `${this.baseUrl}/v6/deployments?projectId=${projectId}&limit=${limit}`,
        {
          headers: this.getHeaders()
        }
      )

      if (!response.ok) {
        throw new Error(`Failed to fetch deployments: ${response.statusText}`)
      }

      const data = await response.json()
      const deployments = data.deployments || []

      return deployments.map((d: any) => ({
        id: d.id,
        url: `https://${d.url}`,
        state: d.readyState,
        readyState: d.readyState,
        createdAt: d.createdAt,
        buildingAt: d.buildingAt,
        readyAt: d.readyAt,
        target: d.target,
        source: 'git',
        projectId: d.projectId,
        meta: {
          githubCommitSha: d.meta?.githubCommitSha || '',
          githubCommitRef: d.meta?.githubCommitRef || '',
          githubCommitRepo: d.meta?.githubCommitRepo || '',
          githubCommitOrg: d.meta?.githubCommitOrg || ''
        }
      }))
    } catch (error) {
      log.error({ err: error }, 'Error listing deployments:')
      return []
    }
  }
}