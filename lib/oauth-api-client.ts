/**
 * Astrid OAuth API Client
 *
 * Client library for accessing Astrid tasks via OAuth 2.0 Client Credentials flow
 * This replaces the legacy MCP-based client for AI agent integrations
 */

import { brandOrigin } from '@/lib/brand/config'
import { type OAuthScope } from './oauth/oauth-scopes'
import { safeResponseJson } from './safe-parse'
import { createLogger } from '@/lib/logger'

const log = createLogger('oauth-api-client')


interface OAuthTokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  scope: string
}

interface APIResponse<T = any> {
  success: boolean
  data?: T
  error?: string
}

interface Task {
  id: string
  title: string
  description?: string | null
  priority: number
  isCompleted: boolean
  dueDateTime?: string | null
  createdAt: string
  updatedAt: string
}

interface TaskList {
  id: string
  name: string
  isPrivate: boolean
  createdAt: string
  updatedAt: string
}

interface Comment {
  id: string
  content: string
  createdAt: string
  authorId: string
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
}

export class OAuthAPIClient {
  private readonly baseUrl: string
  private readonly clientId: string
  private readonly clientSecret: string
  private accessToken: string | null = null
  private tokenExpiry: number = 0

  constructor(options?: {
    baseUrl?: string
    clientId?: string
    clientSecret?: string
  }) {
    this.baseUrl = options?.baseUrl || process.env.ASTRID_API_BASE_URL || brandOrigin()
    this.clientId = options?.clientId || process.env.ASTRID_OAUTH_CLIENT_ID || ''
    this.clientSecret = options?.clientSecret || process.env.ASTRID_OAUTH_CLIENT_SECRET || ''

    if (!this.clientId || !this.clientSecret) {
      log.warn('⚠️ OAuth credentials not configured. Set ASTRID_OAUTH_CLIENT_ID and ASTRID_OAUTH_CLIENT_SECRET')
    }
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
    try {
      // Check if we have a valid token
      if (this.accessToken && Date.now() < this.tokenExpiry) {
        return this.accessToken
      }

      log.info('🔑 Obtaining OAuth access token...')

      const response = await fetch(`${this.baseUrl}/api/v1/oauth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          client_id: this.clientId,
          client_secret: this.clientSecret,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || `HTTP ${response.status}: ${response.statusText}`)
      }

      const data: OAuthTokenResponse = await response.json()

      this.accessToken = data.access_token
      // Set expiry to 5 minutes before actual expiry for safety
      this.tokenExpiry = Date.now() + ((data.expires_in - 300) * 1000)

      log.info('✅ Access token obtained successfully')
      return this.accessToken

    } catch (error) {
      log.error({ err: error }, '❌ Failed to obtain access token:')
      throw error
    }
  }

  /**
   * Make an authenticated API request
   */
  private async makeRequest<T = any>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const token = await this.obtainAccessToken()

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        ...options.headers,
        'X-OAuth-Token': token,  // Use X-OAuth-Token header (works in production)
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      const error = await safeResponseJson<{ error?: string }>(
        response,
        { error: response.statusText }
      )
      throw new Error(error.error || `HTTP ${response.status}: ${response.statusText}`)
    }

    return safeResponseJson<T>(response, {} as T)
  }

  /**
   * Get all lists accessible to the authenticated user
   */
  async getLists(): Promise<APIResponse<TaskList[]>> {
    try {
      const data = await this.makeRequest<{ lists: TaskList[] }>('/api/v1/lists')
      return {
        success: true,
        data: data.lists,
      }
    } catch (error) {
      log.error({ err: error }, '❌ Failed to get lists:')
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Get all tasks, optionally filtered by list
   */
  async getTasks(listId?: string, includeCompleted: boolean = false): Promise<APIResponse<Task[]>> {
    try {
      const params = new URLSearchParams()
      if (listId) params.append('listId', listId)
      if (includeCompleted) params.append('includeCompleted', 'true')

      const queryString = params.toString()
      const endpoint = queryString ? `/api/v1/tasks?${queryString}` : '/api/v1/tasks'

      const data = await this.makeRequest<{ tasks: Task[] }>(endpoint)
      return {
        success: true,
        data: data.tasks,
      }
    } catch (error) {
      log.error({ err: error }, '❌ Failed to get tasks:')
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Get a specific task by ID
   */
  async getTask(taskId: string): Promise<APIResponse<Task>> {
    try {
      const data = await this.makeRequest<{ task: Task }>(`/api/v1/tasks/${taskId}`)
      return {
        success: true,
        data: data.task,
      }
    } catch (error) {
      log.error({ err: error }, '❌ Failed to get task:')
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Create a new task
   */
  async createTask(taskData: CreateTaskData): Promise<APIResponse<Task>> {
    try {
      log.info({ title: taskData.title }, '📝 Creating task')

      const data = await this.makeRequest<{ task: Task }>('/api/v1/tasks', {
        method: 'POST',
        body: JSON.stringify(taskData),
      })

      log.info({ taskId: data.task.id }, '✅ Task created successfully')
      return {
        success: true,
        data: data.task,
      }
    } catch (error) {
      log.error({ err: error }, '❌ Failed to create task:')
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Update an existing task
   */
  async updateTask(taskId: string, updates: UpdateTaskData): Promise<APIResponse<Task>> {
    try {
      log.info({ taskId }, '📝 Updating task:')

      const data = await this.makeRequest<{ task: Task }>(`/api/v1/tasks/${taskId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      })

      log.info('✅ Task updated successfully')
      return {
        success: true,
        data: data.task,
      }
    } catch (error) {
      log.error({ err: error }, '❌ Failed to update task:')
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Add a comment to a task
   */
  async addComment(taskId: string, content: string): Promise<APIResponse<Comment>> {
    try {
      log.info({ taskId }, '💬 Adding comment to task:')

      const data = await this.makeRequest<{ comment: Comment }>(
        `/api/v1/tasks/${taskId}/comments`,
        {
          method: 'POST',
          body: JSON.stringify({ content }),
        }
      )

      log.info('✅ Comment added successfully')
      return {
        success: true,
        data: data.comment,
      }
    } catch (error) {
      log.error({ err: error }, '❌ Failed to add comment:')
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
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

      log.info('🔍 Testing API connection...')

      const result = await this.getLists()

      if (result.success) {
        log.info('✅ API connection successful')
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
      log.error({ err: error }, '❌ API connection failed:')
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      }
    }
  }
}

// Singleton instance for use throughout the app
export const oauthAPIClient = new OAuthAPIClient()

// Export types for use in other files
export type {
  Task,
  TaskList,
  Comment,
  CreateTaskData,
  UpdateTaskData,
  APIResponse,
}
