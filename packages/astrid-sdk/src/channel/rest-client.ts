import { resolveApiBase } from '../config/api-base.js'
import type { OAuthClient } from './oauth-client.js'
import type { AgentTask, AgentComment } from './types.js'

interface RecoveryQueue {
  queue: { id: string }[]
  truncated: boolean
  attention: {
    tasks: { id: string; completed: boolean; statusRole: string | null; lastComment: { id: string } }[]
    messages: unknown[]
    truncated: boolean
    skipped: string[]
  }
}

function isRecoveryQueue(value: unknown): value is RecoveryQueue {
  if (!value || typeof value !== 'object' || !('queue' in value) || !('attention' in value)) return false
  const attention = value.attention
  return Array.isArray(value.queue)
    && value.queue.every(entry => entry && typeof entry.id === 'string' && entry.id.length > 0)
    && !!attention && typeof attention === 'object' && 'tasks' in attention
    && Array.isArray(attention.tasks)
    && attention.tasks.every(entry => entry && typeof entry.id === 'string' && entry.id.length > 0
      && typeof entry.completed === 'boolean' && (entry.statusRole === null || typeof entry.statusRole === 'string')
      && entry.lastComment && typeof entry.lastComment.id === 'string' && entry.lastComment.id.length > 0)
}

class AstridApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

/**
 * REST client for the Astrid Agent Protocol endpoints.
 */
export class RestClient {
  private claimUnavailable = false
  constructor(
    private apiBase: string = resolveApiBase(),
    private oauth: OAuthClient
  ) {}

  private async authenticatedFetch(path: string, options: RequestInit = {}): Promise<Response> {
    const token = await this.oauth.ensureToken()
    const url = `${this.apiBase}${path}`

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

    return res
  }

  private async request<T = any>(path: string, options: RequestInit = {}): Promise<T> {
    const res = await this.authenticatedFetch(`/agent${path}`, options)
    if (!res.ok) {
      throw new AstridApiError(res.status, `Astrid API error: ${res.status} ${res.statusText} on ${path}`)
    }

    return res.json() as Promise<T>
  }

  async getRecoveryQueue(agentMailbox: string, listId?: string): Promise<RecoveryQueue> {
    const params = new URLSearchParams({ agent: agentMailbox })
    if (listId) params.set('listId', listId)
    const res = await this.authenticatedFetch(`/agent-queue?${params}`)
    if (!res.ok) throw new Error(`Astrid recovery queue failed: ${res.status}`)
    const data: unknown = await res.json()
    if (!isRecoveryQueue(data)) {
      throw new Error('Astrid recovery: invalid queue response')
    }
    if (data.truncated || data.attention.truncated) console.warn('Astrid recovery: queue or attention is truncated')
    if (data.attention.messages?.length || data.attention.skipped?.length) {
      console.warn('Astrid recovery: list-chat attention is not delivered by the task channel')
    }
    return data
  }

  /** Lazy body-shaped feature detection; unavailable claims never block older servers. */
  async claimTask(id: string, action: 'claim' | 'resume', agentMailbox: string): Promise<boolean> {
    if (this.claimUnavailable) return true
    try {
      const res = await this.authenticatedFetch(`/tasks/${encodeURIComponent(id)}/claim`, {
        method: 'POST',
        body: JSON.stringify({ action, agentMailbox }),
      })
      const body: unknown = await res.json()
      if (body && typeof body === 'object' && 'outcome' in body && 'task' in body) {
        const snapshot = body.task
        const matchingTask = snapshot && typeof snapshot === 'object' && 'id' in snapshot && snapshot.id === id
        if (res.status === 200 && matchingTask && (body.outcome === 'claimed' || body.outcome === 'already_yours')) return true
        if (res.status === 409 && matchingTask && (body.outcome === 'conflict' || body.outcome === 'not_ready')) return false
        if (res.status === 404 && body.outcome === 'not_found' && snapshot === null) return false
      }
    } catch {
      // Network, token, or JSON errors mean this optional API cannot be used.
      // The warning below records the fallback once for this channel instance.
    }
    this.claimUnavailable = true
    console.warn('Astrid recovery: claim API unavailable; falling back to unclaimed delivery for this channel instance')
    return true
  }

  async getAssignedTasks(completed = false): Promise<AgentTask[]> {
    const data = await this.request<{ tasks: AgentTask[] }>(`/tasks?completed=${completed}`)
    return data.tasks
  }

  async getTask(id: string): Promise<AgentTask> {
    const data = await this.request<{ task: AgentTask }>(`/tasks/${id}`)
    return data.task
  }

  async getPendingTask(id: string): Promise<AgentTask | null> {
    try {
      return await this.getTask(id)
    } catch (error) {
      if (!(error instanceof AstridApiError) || error.status !== 404) throw error
      console.warn('Astrid recovery: pending task is no longer assigned or visible; clearing its delivery intent')
      return null
    }
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
