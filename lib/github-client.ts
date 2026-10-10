/**
 * Phase 3: GitHub API Client
 * Handles all GitHub operations for the coding agent
 */

import type { App } from '@octokit/app'
import { getGitHubApp } from '@/lib/github/app'
import { installationReposForUser, installationsForUser } from '@/lib/github/installations'
import { Octokit } from '@octokit/rest'
import { prisma } from './prisma'
import { createLogger } from './logger'

const log = createLogger('GitHubClient')

export interface FileChange {
  path: string
  content: string
  mode?: 'create' | 'update' | 'delete'
  encoding?: 'utf-8' | 'base64'
}

export interface PullRequestInfo {
  number: number
  url: string
  htmlUrl: string
  title: string
  body: string
  head: {
    ref: string
    sha: string
  }
  base: {
    ref: string
    sha: string
  }
}

export interface CommitInfo {
  sha: string
  url: string
  message: string
}

// Repository info from GitHubIntegration.repositories JSON field
interface RepositoryInfo {
  id: number
  name: string
  owner: string
  private: boolean
  fullName: string
  defaultBranch: string
  installationId: number
}

/**
 * GitHub API client for coding agent operations
 */
export class GitHubClient {
  private app: App
  private octokitCache: Map<number, any> = new Map() // Cache Octokit per installationId
  private defaultInstallationId: number | null = null
  private repositories: RepositoryInfo[] = [] // Per-repo installation mapping
  private accountInstallations: Map<string, number> = new Map() // owner login → installation

  constructor() {
    // Initialize GitHub App
    log.debug({
      appId: process.env.GITHUB_APP_ID,
      hasPrivateKey: !!process.env.GITHUB_APP_PRIVATE_KEY,
      hasWebhookSecret: !!process.env.GITHUB_WEBHOOK_SECRET
    }, 'Initializing GitHub App')

    this.app = getGitHubApp()
    log.debug('GitHub App initialized successfully')
  }

  /**
   * Create a GitHub client for a specific user
   */
  static async forUser(userId: string): Promise<GitHubClient> {
    const client = new GitHubClient()
    await client.authenticateForUser(userId)
    return client
  }

  /**
   * Authenticate the client for a specific user.
   *
   * The repo → installation map spans EVERY installation the user can act on
   * (AWTD-1111). It used to come from the user's first GitHubIntegration row
   * only, so a repo in a second org resolved to the first org's installation,
   * whose token cannot see it.
   *
   * While GitHubIntegration is still dual-written (until P3b), its cached
   * repos fill in anything the installation model does not have yet, so no
   * link that worked before this change stops working.
   */
  private async authenticateForUser(userId: string): Promise<void> {
    const [installations, installationRepos, legacyIntegrations] = await Promise.all([
      installationsForUser(userId),
      installationReposForUser(userId),
      prisma.gitHubIntegration.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    ])

    const known = new Set(installationRepos.map(repo => repo.fullName.toLowerCase()))
    const legacyRepos: RepositoryInfo[] = []
    for (const integration of legacyIntegrations) {
      if (!integration.installationId || !Array.isArray(integration.repositories)) continue
      for (const repo of integration.repositories as unknown as Partial<RepositoryInfo>[]) {
        if (!repo?.fullName || known.has(repo.fullName.toLowerCase())) continue
        known.add(repo.fullName.toLowerCase())
        // The cached installationId was missing on webhook-added repos; the
        // link's own installation is the one that reaches them.
        legacyRepos.push({ ...(repo as RepositoryInfo), installationId: integration.installationId })
      }
    }
    this.repositories = [...installationRepos, ...legacyRepos]

    this.accountInstallations = new Map()
    for (const installation of installations) {
      this.accountInstallations.set(installation.accountLogin.toLowerCase(), installation.id)
    }
    for (const repo of this.repositories) {
      const owner = repo.fullName.split('/')[0]?.toLowerCase()
      if (owner && !this.accountInstallations.has(owner)) this.accountInstallations.set(owner, repo.installationId)
    }

    this.defaultInstallationId =
      installations[0]?.id ?? legacyIntegrations.find(i => i.installationId)?.installationId ?? null

    log.debug({
      userId,
      installations: installations.length,
      repoCount: this.repositories.length,
      legacyRepoCount: legacyRepos.length,
      defaultInstallationId: this.defaultInstallationId,
    }, 'Loaded repository installation mappings')

    if (!this.defaultInstallationId) {
      throw new Error(`No GitHub integration found for user ${userId}`)
    }

    try {
      await this.getOctokitForInstallation(this.defaultInstallationId)
    } catch (error) {
      log.error({ error }, 'Failed to create Octokit')
      throw new Error(`Failed to authenticate GitHub App: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * The installation that reaches a repo: the one that lists it, else the one
   * on the repo owner's account (a repo added since the last refresh), and only
   * then the default — which is the wrong org for any repo outside it.
   */
  private getInstallationIdForRepo(repoFullName: string): number {
    const repoInfo = this.repositories.find(
      r => r.fullName.toLowerCase() === repoFullName.toLowerCase()
    )
    if (repoInfo) return repoInfo.installationId

    const owner = repoFullName.split('/')[0]?.toLowerCase()
    const byOwner = owner ? this.accountInstallations.get(owner) : undefined
    if (byOwner) return byOwner

    if (!this.defaultInstallationId) {
      throw new Error('GitHub client not authenticated. Call authenticateForUser() first.')
    }
    log.debug({ repo: repoFullName, installationId: this.defaultInstallationId }, 'Using default installation ID (repo not in mapping)')
    return this.defaultInstallationId
  }

  /**
   * Get or create an Octokit instance for a specific installation
   */
  private async getOctokitForInstallation(installationId: number): Promise<any> {
    // Check cache first
    const cached = this.octokitCache.get(installationId)
    if (cached) {
      return cached
    }

    // Create new Octokit for this installation
    log.debug({ installationId }, 'Creating Octokit for installation')
    const octokit = await this.app.getInstallationOctokit(installationId)
    this.octokitCache.set(installationId, octokit)
    return octokit
  }

  /**
   * Ensure the client is authenticated and get Octokit for a specific repo
   */
  private async ensureAuthenticatedForRepo(repoFullName: string): Promise<any> {
    const installationId = this.getInstallationIdForRepo(repoFullName)
    return this.getOctokitForInstallation(installationId)
  }

  /**
   * Ensure the client is authenticated (uses default installation)
   * @deprecated Use ensureAuthenticatedForRepo for repo-specific operations
   */
  private ensureAuthenticated(): any {
    if (!this.defaultInstallationId) {
      throw new Error('GitHub client not authenticated. Call authenticateForUser() first.')
    }
    const octokit = this.octokitCache.get(this.defaultInstallationId)
    if (!octokit) {
      throw new Error('GitHub client not authenticated. Call authenticateForUser() first.')
    }
    return octokit
  }

  /**
   * Parse repository full name into owner and repo
   */
  private parseRepo(repoFullName: string): { owner: string; repo: string } {
    const [owner, repo] = repoFullName.split('/')
    if (!owner || !repo) {
      throw new Error(`Invalid repository format: ${repoFullName}. Expected format: "owner/repo"`)
    }
    return { owner, repo }
  }

  /**
   * Get repository information
   */
  async getRepository(repoFullName: string) {
    const octokit = await this.ensureAuthenticatedForRepo(repoFullName)
    const { owner, repo } = this.parseRepo(repoFullName)

    try {
      const { data } = await octokit.request('GET /repos/{owner}/{repo}', {
        owner,
        repo
      })

      return {
        id: data.id,
        name: data.name,
        fullName: data.full_name,
        defaultBranch: data.default_branch,
        private: data.private,
        url: data.html_url,
        cloneUrl: data.clone_url
      }
    } catch (error) {
      throw new Error(`Failed to get repository ${repoFullName}: ${error}`)
    }
  }

  /**
   * Create a new branch from base branch
   */
  async createBranch(repoFullName: string, baseBranch: string, newBranch: string): Promise<void> {
    const octokit = await this.ensureAuthenticatedForRepo(repoFullName)
    const { owner, repo } = this.parseRepo(repoFullName)

    try {
      // Get the SHA of the base branch
      const { data: baseRef } = await octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', {
        owner,
        repo,
        ref: `heads/${baseBranch}`
      })

      // Create new branch
      await octokit.request('POST /repos/{owner}/{repo}/git/refs', {
        owner,
        repo,
        ref: `refs/heads/${newBranch}`,
        sha: baseRef.object.sha
      })

      log.info({ repo: repoFullName, newBranch, baseBranch }, 'Created branch')
    } catch (error: any) {
      if (error.status === 422) {
        throw new Error(`Branch ${newBranch} already exists in ${repoFullName}`)
      }
      throw new Error(`Failed to create branch ${newBranch}: ${error.message}`)
    }
  }

  /**
   * Commit multiple file changes to a branch
   */
  async commitChanges(
    repoFullName: string,
    branch: string,
    changes: FileChange[],
    commitMessage: string
  ): Promise<CommitInfo> {
    const octokit = await this.ensureAuthenticatedForRepo(repoFullName)
    const { owner, repo } = this.parseRepo(repoFullName)

    try {
      // Get the current commit SHA for the branch
      const { data: ref } = await octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', {
        owner,
        repo,
        ref: `heads/${branch}`
      })

      const currentCommitSha = ref.object.sha

      // Get the tree SHA for the current commit
      const { data: currentCommit } = await octokit.request('GET /repos/{owner}/{repo}/git/commits/{commit_sha}', {
        owner,
        repo,
        commit_sha: currentCommitSha
      })

      const currentTreeSha = currentCommit.tree.sha

      // Create blobs for each file change
      const treeItems = await Promise.all(
        changes.map(async (change) => {
          if (change.mode === 'delete') {
            // For deletions, we don't create a blob
            return {
              path: change.path,
              mode: '100644' as const,
              type: 'blob' as const,
              sha: null // null means delete
            }
          }

          // Create blob for file content
          const { data: blob } = await octokit.request('POST /repos/{owner}/{repo}/git/blobs', {
            owner,
            repo,
            content: change.content,
            encoding: change.encoding || 'utf-8'
          })

          return {
            path: change.path,
            mode: '100644' as const,
            type: 'blob' as const,
            sha: blob.sha
          }
        })
      )

      // Create new tree
      const { data: newTree } = await octokit.request('POST /repos/{owner}/{repo}/git/trees', {
        owner,
        repo,
        base_tree: currentTreeSha,
        tree: treeItems
      })

      // Create new commit
      const { data: newCommit } = await octokit.request('POST /repos/{owner}/{repo}/git/commits', {
        owner,
        repo,
        message: commitMessage,
        tree: newTree.sha,
        parents: [currentCommitSha]
      })

      // Update the branch reference
      await octokit.request('PATCH /repos/{owner}/{repo}/git/refs/{ref}', {
        owner,
        repo,
        ref: `heads/${branch}`,
        sha: newCommit.sha
      })

      log.info({ repo: repoFullName, branch, changeCount: changes.length }, 'Committed changes')

      return {
        sha: newCommit.sha,
        url: newCommit.url,
        message: commitMessage
      }
    } catch (error) {
      throw new Error(`Failed to commit changes to ${branch}: ${error}`)
    }
  }

  /**
   * Create a pull request
   */
  async createPullRequest(
    repoFullName: string,
    headBranch: string,
    baseBranch: string,
    title: string,
    body: string
  ): Promise<PullRequestInfo> {
    const octokit = await this.ensureAuthenticatedForRepo(repoFullName)
    const { owner, repo } = this.parseRepo(repoFullName)

    try {
      log.debug({ repo: repoFullName, headBranch, baseBranch }, 'Creating pull request')
      const { data: pr } = await octokit.request('POST /repos/{owner}/{repo}/pulls', {
        owner,
        repo,
        title,
        body,
        head: headBranch,
        base: baseBranch
      })

      log.info({ repo: repoFullName, prNumber: pr.number }, 'Created pull request')

      return {
        number: pr.number,
        url: pr.url,
        htmlUrl: pr.html_url,
        title: pr.title,
        body: pr.body || '',
        head: {
          ref: pr.head.ref,
          sha: pr.head.sha
        },
        base: {
          ref: pr.base.ref,
          sha: pr.base.sha
        }
      }
    } catch (error: any) {
      // Extract detailed error information from GitHub API response
      let errorMessage = 'Failed to create pull request'
      
      if (error?.response?.data) {
        const ghError = error.response.data
        errorMessage = `Failed to create pull request: ${ghError.message || 'Unknown error'}`
        
        // Add specific error details
        if (ghError.errors) {
          const errorDetails = ghError.errors.map((e: any) => e.message || e).join(', ')
          errorMessage += ` (${errorDetails})`
        }
        
        // Common GitHub API errors
        if (ghError.message?.includes('already exists')) {
          errorMessage = `A pull request from branch "${headBranch}" to "${baseBranch}" already exists. Please use the existing PR or create a new branch.`
        } else if (ghError.message?.includes('No commits between')) {
          errorMessage = `No commits between "${baseBranch}" and "${headBranch}". Make sure you've committed changes to the branch before creating a PR.`
        } else if (ghError.message?.includes('not found')) {
          errorMessage = `Branch "${headBranch}" not found in repository. Make sure the branch exists and has been pushed to GitHub.`
        } else if (ghError.message?.includes('permission')) {
          errorMessage = `Permission denied. The GitHub App may not have write access to repository "${repoFullName}". Please check the App installation permissions.`
        }
      } else if (error instanceof Error) {
        errorMessage = `Failed to create pull request: ${error.message}`
      } else {
        errorMessage = `Failed to create pull request: ${String(error)}`
      }
      
      log.error({
        error,
        repo: repoFullName,
        headBranch,
        baseBranch,
        errorMessage
      }, 'PR creation failed')

      throw new Error(errorMessage)
    }
  }

  /**
   * Add a comment to a pull request
   */
  async addPullRequestComment(
    repoFullName: string,
    prNumber: number,
    comment: string
  ): Promise<void> {
    const octokit = await this.ensureAuthenticatedForRepo(repoFullName)
    const { owner, repo } = this.parseRepo(repoFullName)

    try {
      await octokit.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body: comment
      })

      log.info({ repo: repoFullName, prNumber }, 'Added comment to PR')
    } catch (error) {
      throw new Error(`Failed to add comment to PR #${prNumber}: ${error}`)
    }
  }

  /**
   * Get comments from a pull request
   */
  async getPullRequestComments(
    repoFullName: string,
    prNumber: number
  ): Promise<Array<{
    id: number
    user: { login: string; type: string }
    body: string
    created_at: string
    updated_at: string
  }>> {
    const octokit = await this.ensureAuthenticatedForRepo(repoFullName)
    const { owner, repo } = this.parseRepo(repoFullName)

    try {
      const response = await octokit.issues.listComments({
        owner,
        repo,
        issue_number: prNumber,
        per_page: 100
      })

      log.debug({ repo: repoFullName, prNumber, commentCount: response.data.length }, 'Retrieved PR comments')

      return response.data.map((comment: any) => ({
        id: comment.id,
        user: {
          login: comment.user.login,
          type: comment.user.type
        },
        body: comment.body,
        created_at: comment.created_at,
        updated_at: comment.updated_at
      }))
    } catch (error) {
      throw new Error(`Failed to get comments from PR #${prNumber}: ${error}`)
    }
  }

  /**
   * Merge a pull request
   */
  async mergePullRequest(
    repoFullName: string,
    prNumber: number,
    mergeMethod: 'merge' | 'squash' | 'rebase' = 'squash'
  ): Promise<void> {
    const octokit = await this.ensureAuthenticatedForRepo(repoFullName)
    const { owner, repo } = this.parseRepo(repoFullName)

    try {
      const { data } = await octokit.request('PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge', {
        owner,
        repo,
        pull_number: prNumber,
        merge_method: mergeMethod
      })

      log.info({ repo: repoFullName, prNumber, sha: data.sha }, 'Merged pull request')
    } catch (error) {
      throw new Error(`Failed to merge PR #${prNumber}: ${error}`)
    }
  }

  /**
   * Get file contents from a repository
   * @param repoFullName - Repository in "owner/repo" format
   * @param path - File path in the repository
   * @param ref - Branch/commit ref (default: default branch)
   * @returns File contents as a string
   */
  async getFile(repoFullName: string, path: string, ref?: string): Promise<string> {
    const octokit = await this.ensureAuthenticatedForRepo(repoFullName)
    const { owner, repo } = this.parseRepo(repoFullName)

    try {
      const { data } = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
        owner,
        repo,
        path,
        ...(ref && { ref })
      })

      // GitHub returns base64-encoded content for files
      if ('content' in data && typeof data.content === 'string') {
        const content = Buffer.from(data.content, 'base64').toString('utf-8')
        log.debug({ repo: repoFullName, path, bytes: content.length }, 'Read file')
        return content
      }

      // If it's a directory or symlink, throw an error
      if (Array.isArray(data)) {
        throw new Error(`Path ${path} is a directory, not a file`)
      }

      throw new Error(`File ${path} has unexpected type: ${data.type}`)
    } catch (error: any) {
      if (error.status === 404) {
        throw new Error(`File ${path} not found in ${repoFullName}`)
      }
      throw new Error(`Failed to read file ${path}: ${error.message || error}`)
    }
  }

  /**
   * List files in a directory
   * @param repoFullName - Repository in "owner/repo" format
   * @param path - Directory path (empty string for root)
   * @param ref - Branch/commit ref (default: default branch)
   * @returns Array of file/directory information
   */
  async listFiles(repoFullName: string, path: string = '', ref?: string): Promise<Array<{
    name: string
    path: string
    type: 'file' | 'dir' | 'symlink' | 'submodule'
    size: number
  }>> {
    const octokit = await this.ensureAuthenticatedForRepo(repoFullName)
    const { owner, repo } = this.parseRepo(repoFullName)

    try {
      const { data } = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
        owner,
        repo,
        path,
        ...(ref && { ref })
      })

      if (Array.isArray(data)) {
        return data.map(item => ({
          name: item.name,
          path: item.path,
          type: item.type as 'file' | 'dir' | 'symlink' | 'submodule',
          size: item.size || 0
        }))
      }

      // If it's a single file, return it as an array with one item
      return [{
        name: data.name,
        path: data.path,
        type: data.type as 'file' | 'dir' | 'symlink' | 'submodule',
        size: data.size || 0
      }]
    } catch (error: any) {
      if (error.status === 404) {
        throw new Error(`Path ${path} not found in ${repoFullName}`)
      }
      throw new Error(`Failed to list files at ${path}: ${error.message || error}`)
    }
  }

  /**
   * Set commit status (for CI/checks)
   */
  async setCommitStatus(
    repoFullName: string,
    sha: string,
    state: 'pending' | 'success' | 'error' | 'failure',
    options: {
      description?: string
      targetUrl?: string
      context?: string
    } = {}
  ): Promise<void> {
    const octokit = await this.ensureAuthenticatedForRepo(repoFullName)
    const { owner, repo } = this.parseRepo(repoFullName)

    try {
      await octokit.request('POST /repos/{owner}/{repo}/statuses/{sha}', {
        owner,
        repo,
        sha,
        state,
        description: options.description,
        target_url: options.targetUrl,
        context: options.context || 'astrid-code-assistant'
      })

      log.debug({ repo: repoFullName, sha, state }, 'Set commit status')
    } catch (error) {
      throw new Error(`Failed to set commit status: ${error}`)
    }
  }

  /**
   * Get installation repositories for the current user
   */
  async getInstallationRepositories(installationId?: number): Promise<Array<{
    id: number
    name: string
    fullName: string
    private: boolean
    defaultBranch: string
  }>> {
    const octokit = installationId
      ? await this.getOctokitForInstallation(installationId)
      : this.ensureAuthenticated()

    try {
      const { data } = await octokit.apps.listReposAccessibleToInstallation()

      return data.repositories.map((repo: any) => ({
        id: repo.id,
        name: repo.name,
        fullName: repo.full_name,
        private: repo.private,
        defaultBranch: repo.default_branch
      }))
    } catch (error) {
      throw new Error(`Failed to get installation repositories: ${error}`)
    }
  }

  /**
   * Check if a branch exists
   */
  async branchExists(repoFullName: string, branch: string): Promise<boolean> {
    const octokit = await this.ensureAuthenticatedForRepo(repoFullName)
    const { owner, repo } = this.parseRepo(repoFullName)

    try {
      await octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', {
        owner,
        repo,
        ref: `heads/${branch}`
      })
      return true
    } catch (error: any) {
      if (error.status === 404) {
        return false
      }
      throw error
    }
  }

  /**
   * Delete a branch
   */
  async deleteBranch(repoFullName: string, branch: string): Promise<void> {
    const octokit = await this.ensureAuthenticatedForRepo(repoFullName)
    const { owner, repo } = this.parseRepo(repoFullName)

    try {
      await octokit.request('DELETE /repos/{owner}/{repo}/git/refs/{ref}', {
        owner,
        repo,
        ref: `heads/${branch}`
      })

      log.info({ repo: repoFullName, branch }, 'Deleted branch')
    } catch (error) {
      throw new Error(`Failed to delete branch ${branch}: ${error}`)
    }
  }
}

export default GitHubClient