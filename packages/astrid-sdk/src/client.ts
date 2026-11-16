/**
 * Typed REST client for the agent endpoints: the queue, claims, comments and
 * the status and handback writes. One method per existing server route; it
 * invents no endpoints and adds no fields.
 *
 * Two ways to authenticate, the same two the generated workflows use:
 *   - `{ token }`: an agent-bound token (`astrid_mcp_…` or an agent consent
 *     token), sent as `Authorization: Bearer`. Writes are signed as that agent
 *     and the claim route can tell which agent is claiming.
 *   - `{ clientId, clientSecret }`: client credentials, exchanged once at
 *     `/api/v1/oauth/token` and sent as `X-OAuth-Token`. Such a token carries
 *     no agent binding, so the generic claim route answers `forbidden`; use
 *     `claimFixallTask` or an agent-bound token for claims.
 */

import { resolveOrigin } from './config/api-base.js'
import type {
  AgentQueueQuery,
  AgentQueueResponse,
  AstridComment,
  AstridTask,
  ClaimOutcome,
  ClaimRequest,
  ClaimResult,
  FixallClaimRequest,
  FixallClaimResult,
  SignedWrite,
} from './types.js'

export type AstridAuth =
  | { token: string }
  | { clientId: string; clientSecret: string; scope?: string }

export interface AstridClientOptions {
  /** Origin, e.g. `https://www.astrid.cc`. Defaults to ASTRID_API_URL, then production. */
  origin?: string
  auth: AstridAuth
  /** Injected for tests and non-global runtimes. */
  fetch?: typeof fetch
}

/** A response the server refused. `status` is the HTTP status; the message carries its reason. */
export class AstridApiError extends Error {
  constructor(readonly status: number, message: string, readonly body: unknown = null) {
    super(message)
    this.name = 'AstridApiError'
  }
}

const CLAIM_OUTCOMES: ReadonlySet<string> = new Set<ClaimOutcome>([
  'claimed', 'already_yours', 'released', 'renewed', 'conflict', 'not_ready', 'not_found', 'forbidden', 'binding_denied',
])

function reasonOf(body: unknown): string | undefined {
  if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') return body.error
  return undefined
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null)
}

export class AstridClient {
  readonly origin: string
  private readonly auth: AstridAuth
  private readonly fetchImpl: typeof fetch
  private exchanged: { token: string; expiresAt: number } | null = null

  constructor(options: AstridClientOptions) {
    this.origin = resolveOrigin(options.origin)
    this.auth = options.auth
    this.fetchImpl = options.fetch ?? globalThis.fetch
  }

  private async authHeaders(): Promise<Record<string, string>> {
    if ('token' in this.auth) return { Authorization: `Bearer ${this.auth.token}` }
    if (!this.exchanged || Date.now() >= this.exchanged.expiresAt) {
      const response = await this.fetchImpl(`${this.origin}/api/v1/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          client_id: this.auth.clientId,
          client_secret: this.auth.clientSecret,
          ...(this.auth.scope ? { scope: this.auth.scope } : {}),
        }),
      })
      const body = await readJson(response)
      if (!response.ok) {
        throw new AstridApiError(response.status, `OAuth token request failed: HTTP ${response.status}`, body)
      }
      const { access_token: token, expires_in: expiresIn } = (body ?? {}) as { access_token?: string; expires_in?: number }
      if (!token) throw new AstridApiError(response.status, 'OAuth token response had no access_token', null)
      // Refresh five minutes early, as the old clients did.
      this.exchanged = { token, expiresAt: Date.now() + Math.max(0, (expiresIn ?? 3600) - 300) * 1000 }
    }
    return { 'X-OAuth-Token': this.exchanged.token }
  }

  /** One request; returns status and parsed body without judging either. */
  private async send(path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; ok: boolean; body: unknown }> {
    const headers: Record<string, string> = { ...(await this.authHeaders()) }
    if (init.body !== undefined) headers['Content-Type'] = 'application/json'
    const response = await this.fetchImpl(`${this.origin}${path}`, {
      method: init.method ?? 'GET',
      headers,
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    })
    return { status: response.status, ok: response.ok, body: await readJson(response) }
  }

  /** A request that must succeed. */
  private async request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const { status, ok, body } = await this.send(path, init)
    if (!ok) {
      const reason = reasonOf(body)
      throw new AstridApiError(status, `HTTP ${status} from ${path.split('?')[0]}${reason ? `: ${reason}` : ''}`, body)
    }
    return body as T
  }

  /** `GET /api/v1/agent-queue`: Ready work plus unanswered comments and messages. */
  async getQueue(query: AgentQueueQuery): Promise<AgentQueueResponse> {
    const params = new URLSearchParams({ agent: query.agent })
    if (query.listId) params.set('listId', query.listId)
    if (query.includeUnassigned) params.set('includeUnassigned', 'true')
    return this.request<AgentQueueResponse>(`/api/v1/agent-queue?${params}`)
  }

  /**
   * `POST /api/v1/tasks/:id/claim`: atomic claim, resume or release. Every
   * documented outcome is returned, not thrown, so a caller can branch on a
   * conflict; only an undocumented answer throws.
   */
  async claimTask(taskId: string, request: ClaimRequest): Promise<ClaimResult> {
    const { status, body } = await this.send(`/api/v1/tasks/${encodeURIComponent(taskId)}/claim`, {
      method: 'POST',
      body: {
        action: request.action,
        // The route compares the mailbox with the token identity's local part,
        // so a Custom Agent address is sent without its domain.
        ...(request.agentMailbox ? { agentMailbox: request.agentMailbox.split('@')[0] } : {}),
        ...(request.leaseSeconds !== undefined ? { leaseSeconds: request.leaseSeconds } : {}),
      },
    })
    if (body && typeof body === 'object' && 'outcome' in body && typeof body.outcome === 'string' && CLAIM_OUTCOMES.has(body.outcome)) {
      const task = 'task' in body ? (body.task as ClaimResult['task']) : null
      return { status, outcome: body.outcome as ClaimOutcome, task: task ?? null }
    }
    // The route is absent on this server (or an older one still gates it).
    if ([404, 405, 501].includes(status)) return { status, outcome: 'unavailable', task: null }
    const reason = reasonOf(body)
    throw new AstridApiError(status, `HTTP ${status} from claim${reason ? `: ${reason}` : ''}`, body)
  }

  /**
   * Renew this agent's claim lease. Send it every few minutes while working:
   * a claim with no heartbeat for its lease (15 minutes by default) returns to
   * Ready. `renewed` means keep going; anything else means the claim is gone.
   */
  async heartbeatTask(taskId: string, options: { agentMailbox?: string; leaseSeconds?: number } = {}): Promise<ClaimResult> {
    return this.claimTask(taskId, { action: 'heartbeat', ...options })
  }

  /** Give a Doing claim back: the task returns to Ready and this agent is unassigned. */
  async releaseTask(taskId: string, agentMailbox?: string): Promise<ClaimResult> {
    return this.claimTask(taskId, { action: 'release', ...(agentMailbox ? { agentMailbox } : {}) })
  }

  /**
   * `POST /api/v1/tasks/:id/claim-fixall`: the claim Astrid's own scheduled
   * loops use. Allowlisted boards and harness mailboxes only; works with
   * client credentials. A 409 is returned as `claimed: false` with the
   * server's reason.
   */
  async claimFixallTask(taskId: string, request: FixallClaimRequest): Promise<FixallClaimResult> {
    const { status, ok, body } = await this.send(`/api/v1/tasks/${encodeURIComponent(taskId)}/claim-fixall`, {
      method: 'POST',
      body: {
        action: request.action,
        commentWatermark: request.commentWatermark ?? null,
        ...(request.agent ? { agent: request.agent } : {}),
        ...(request.resume !== undefined ? { resume: request.resume } : {}),
        ...(request.listId ? { listId: request.listId } : {}),
      },
    })
    if (ok) {
      const assigneeEmail = body && typeof body === 'object' && 'assigneeEmail' in body && typeof body.assigneeEmail === 'string'
        ? body.assigneeEmail : undefined
      return { status, claimed: true, ...(assigneeEmail ? { assigneeEmail } : {}) }
    }
    const reason = reasonOf(body)
    if (status === 409) return { status, claimed: false, ...(reason ? { error: reason } : {}) }
    throw new AstridApiError(status, `HTTP ${status} from claim-fixall${reason ? `: ${reason}` : ''}`, body)
  }

  async getTask(taskId: string): Promise<AstridTask> {
    const body = await this.request<{ task: AstridTask }>(`/api/v1/tasks/${encodeURIComponent(taskId)}`)
    return body.task
  }

  async getComments(taskId: string): Promise<AstridComment[]> {
    const body = await this.request<{ comments: AstridComment[] }>(`/api/v1/tasks/${encodeURIComponent(taskId)}/comments`)
    return body.comments
  }

  async addComment(taskId: string, content: string, options: SignedWrite = {}): Promise<AstridComment> {
    const body = await this.request<{ comment: AstridComment }>(`/api/v1/tasks/${encodeURIComponent(taskId)}/comments`, {
      method: 'POST',
      body: { content, ...(options.aiAgentId ? { aiAgentId: options.aiAgentId } : {}) },
    })
    return body.comment
  }

  /** Move the task's board column (`ready`, `doing`, `waiting`, or null for the Inbox). */
  async setStatus(taskId: string, statusRole: string | null, options: SignedWrite = {}): Promise<AstridTask> {
    return this.updateTask(taskId, { statusRole }, options)
  }

  /**
   * Hand the task back to a person: the Inbox, assigned to them, in one write
   * (astrid-core's `handBack`). Never Waiting, which holds only tasks waiting
   * on a date or another task. `completed` is left out so a task someone
   * finished meanwhile is not reopened.
   */
  async handBack(taskId: string, personId: string, options: SignedWrite = {}): Promise<AstridTask> {
    if (!personId.trim()) throw new Error('A handback needs the person to hand it to')
    return this.updateTask(taskId, { statusRole: null, assigneeId: personId }, options)
  }

  private async updateTask(taskId: string, fields: Record<string, unknown>, options: SignedWrite): Promise<AstridTask> {
    const body = await this.request<{ task: AstridTask }>(`/api/v1/tasks/${encodeURIComponent(taskId)}`, {
      method: 'PUT',
      body: { ...fields, ...(options.aiAgentId ? { aiAgentId: options.aiAgentId } : {}) },
    })
    return body.task
  }
}
