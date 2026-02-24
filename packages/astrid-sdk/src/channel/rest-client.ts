import type { OAuthClient } from './oauth-client.js'
import type { AgentTask, AgentComment } from './types.js'

/**
 * REST client for the Astrid Agent Protocol endpoints.
 */
export class RestClient {
  constructor(
    private apiBase: string = 'https://www.astrid.cc/api/v1',
    private oauth: OAuthClient
  ) {}

  private async request<T = any>(path: string, options: RequestInit = {}): Promise<T> {
    const token = await this.oauth.ensureToken()
    const url = `${this.apiBase}/agent${path}`

    let res = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })

    // Retry once on 401
    if (res.status === 401) {
      const newToken = await this.oauth.refreshToken()
      res = await fetch(url, {
        ...options,
        headers: {
          'Authorization': `Bearer ${newToken}`,
          'Content-Type': 'application/json',
          ...options.headers,
        },
      })
    }

    if (!res.ok) {
      throw new Error(`Astrid API error: ${res.status} ${res.statusText} on ${path}`)
    }

    return res.json() as Promise<T>
  }

  async getAssignedTasks(completed = false): Promise<AgentTask[]> {
    const data = await this.request<{ tasks: AgentTask[] }>(`/tasks?completed=${completed}`)
    return data.tasks
  }

  async getTask(id: string): Promise<AgentTask> {
    const data = await this.request<{ task: AgentTask }>(`/tasks/${id}`)
    return data.task
  }

  async postComment(taskId: string, content: string): Promise<AgentComment> {
    const data = await this.request<{ comment: AgentComment }>(`/tasks/${taskId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    })
    return data.comment
  }

  async completeTask(taskId: string): Promise<AgentTask> {
    const data = await this.request<{ task: AgentTask }>(`/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify({ completed: true }),
    })
    return data.task
  }
}
