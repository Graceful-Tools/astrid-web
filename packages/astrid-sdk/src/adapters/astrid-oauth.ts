/**
 * Astrid OAuth API Client
 *
 * Client for accessing Astrid tasks via OAuth 2.0 Client Credentials flow
 */

import { resolveOrigin } from '../config/api-base.js'
import type { AstridTask, AstridList } from '../types/index.js'

interface OAuthTokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  scope: string
}

interface APIResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

interface Comment {
  id: string
  content: string
  createdAt: string
  authorId: string
  authorEmail?: string
}

interface CreateTaskData {
  title: string
  description?: string
  priority?: number
  listId?: string
  dueDateTime?: string
}

interface UpdateTaskData {
  title?: string
  description?: string
  priority?: number
  isCompleted?: boolean
  dueDateTime?: string
  assigneeId?: string | null
}

export interface AstridOAuthConfig {
  baseUrl?: string
  clientId?: string
  clientSecret?: string
}

export class AstridOAuthClient {
  private readonly baseUrl: string
  private readonly clientId: string
  private readonly clientSecret: string
  private accessToken: string | null = null
  private tokenExpiry: number = 0

  constructor(config?: AstridOAuthConfig) {
    // Was 'https://astrid.cc' while the channel clients defaulted to
    // 'https://www.astrid.cc/api/v1' — the same SDK talking to two different
    // hosts (task 979e1325).
    this.baseUrl = resolveOrigin(config?.baseUrl)
    this.clientId = config?.clientId || process.env.ASTRID_OAUTH_CLIENT_ID || ''
    this.clientSecret = config?.clientSecret || process.env.ASTRID_OAUTH_CLIENT_SECRET || ''
  }

  /**
   * Check if the client is properly configured
   */
  isConfigured(): boolean {
    return !!this.clientId && !!this.clientSecret
  }

  /**
   * Obtain an access token using client credentials flow
   */
  private async obtainAccessToken(): Promise<string> {
    // Check if we have a valid token
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken
    }

    const response = await fetch(`${this.baseUrl}/api/v1/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: response.statusText })) as { error?: string }
      throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`)
    }

    const data = await response.json() as OAuthTokenResponse

    this.accessToken = data.access_token
    // Set expiry to 5 minutes before actual expiry for safety
    this.tokenExpiry = Date.now() + ((data.expires_in - 300) * 1000)

    return this.accessToken
  }

  /**
   * Make an authenticated API request
   */
  private async makeRequest<T = unknown>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const token = await this.obtainAccessToken()

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        ...options.headers,
        'X-OAuth-Token': token,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: response.statusText })) as { error?: string }
      throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`)
    }

    return response.json() as Promise<T>
  }

  /**
   * Get all lists accessible to the authenticated user
   */
  async getLists(): Promise<APIResponse<AstridList[]>> {
    try {
      const data = await this.makeRequest<{ lists: AstridList[] }>('/api/v1/lists')
      return { success: true, data: data.lists }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Get a specific list by ID
   */
  async getList(listId: string): Promise<APIResponse<AstridList>> {
    try {
      const data = await this.makeRequest<{ list: AstridList }>(`/api/v1/lists/${listId}`)
      return { success: true, data: data.list }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Get all tasks, optionally filtered by list
   */
  async getTasks(listId?: string, includeCompleted: boolean = false): Promise<APIResponse<AstridTask[]>> {
    try {
      const params = new URLSearchParams()
      if (listId) params.append('listId', listId)
      if (includeCompleted) params.append('includeCompleted', 'true')

      const queryString = params.toString()
      const endpoint = queryString ? `/api/v1/tasks?${queryString}` : '/api/v1/tasks'

      const data = await this.makeRequest<{ tasks: AstridTask[] }>(endpoint)
      return { success: true, data: data.tasks }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Get a specific task by ID with comments
   */
  async getTask(taskId: string): Promise<APIResponse<AstridTask>> {
    try {
      const data = await this.makeRequest<{ task: AstridTask }>(`/api/v1/tasks/${taskId}`)
      return { success: true, data: data.task }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Get comments for a task
   */
  async getComments(taskId: string): Promise<APIResponse<Comment[]>> {
    try {
      const data = await this.makeRequest<{ comments: Comment[] }>(`/api/v1/tasks/${taskId}/comments`)
      return { success: true, data: data.comments }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Create a new task
   */
  async createTask(taskData: CreateTaskData): Promise<APIResponse<AstridTask>> {
    try {
      const data = await this.makeRequest<{ task: AstridTask }>('/api/v1/tasks', {
        method: 'POST',
        body: JSON.stringify(taskData),
      })
      return { success: true, data: data.task }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Update an existing task
   */
  async updateTask(taskId: string, updates: UpdateTaskData): Promise<APIResponse<AstridTask>> {
    try {
      const data = await this.makeRequest<{ task: AstridTask }>(`/api/v1/tasks/${taskId}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      })
      return { success: true, data: data.task }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Mark a task as complete
   */
  async completeTask(taskId: string): Promise<APIResponse<AstridTask>> {
    return this.updateTask(taskId, { isCompleted: true })
  }

  /**
   * Reassign a task to a different user
   * @param taskId - The task ID
   * @param assigneeId - The user ID to assign to, or null to unassign
   */
  async reassignTask(taskId: string, assigneeId: string | null): Promise<APIResponse<AstridTask>> {
    return this.updateTask(taskId, { assigneeId })
  }

  /**
   * Add a comment to a task
   * @param taskId - The task ID to add the comment to
   * @param content - The comment content
   * @param aiAgentId - Optional AI agent user ID to post the comment as
   */
  async addComment(taskId: string, content: string, aiAgentId?: string): Promise<APIResponse<Comment>> {
    try {
      const body: { content: string; aiAgentId?: string } = { content }
      if (aiAgentId) {
        body.aiAgentId = aiAgentId
      }
      const data = await this.makeRequest<{ comment: Comment }>(
        `/api/v1/tasks/${taskId}/comments`,
        {
          method: 'POST',
          body: JSON.stringify(body),
        }
      )
      return { success: true, data: data.comment }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Get AI agent user ID by email
   * Used to post comments as the AI agent instead of the OAuth client owner
   */
  async getAgentIdByEmail(email: string): Promise<string | null> {
    try {
      // Look up agent in list members
      const listsResult = await this.getLists()
      if (!listsResult.success || !listsResult.data) {
        return null
      }

      for (const list of listsResult.data) {
        const listResult = await this.getList(list.id)
        if (listResult.success && listResult.data) {
          const listData = listResult.data as { listMembers?: Array<{ user?: { id: string; email?: string; isAIAgent?: boolean } }> }
          const member = listData.listMembers?.find(
            m => m.user?.email === email && m.user?.isAIAgent
          )
          if (member?.user?.id) {
            return member.user.id
          }
        }
      }
      return null
    } catch {
      return null
    }
  }

  /**
   * Test the connection to the API
   */
  async testConnection(): Promise<APIResponse> {
    try {
      if (!this.isConfigured()) {
        throw new Error('OAuth credentials not configured')
      }

      const result = await this.getLists()

      if (result.success) {
        return {
          success: true,
          data: {
            message: 'Connection successful',
            listsCount: result.data?.length || 0,
          },
        }
      } else {
        throw new Error(result.error)
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      }
    }
  }
}

// Export types
export type { APIResponse, Comment, CreateTaskData, UpdateTaskData }
