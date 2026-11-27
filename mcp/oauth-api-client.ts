/**
 * OAuth-authenticated HTTP client for the Astrid v1 API, used by the MCP
 * server (both the stdio server and the hosted /mcp endpoint).
 *
 * Extracted from mcp/mcp-server-oauth.ts, which is the MCP protocol surface;
 * this is the transport underneath it. Keeping them apart means the token
 * lifecycle can be tested without standing up a server, which is what
 * tests/lib/mcp-oauth-token-cache.test.ts does.
 */

import { BRAND, mcpDefaultBaseUrl } from "../lib/brand/config"
import { createLogger } from "../lib/logger"
import { fetchMCPBackend } from "../lib/security/mcp-backend"
// Process-level token cache for the hosted /mcp path (task 11f578e0).
import {
  hostedTokenCacheKey,
  withHostedTokenCache,
  type HostedTokenEntry,
} from "./hosted-token-cache"

const log = createLogger("mcp.oauth-client")

interface OAuthTokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  scope: string
}

export interface OAuthAPIClientOptions {
  baseUrl?: string
  clientId?: string
  clientSecret?: string
  accessToken?: string
  hosted?: boolean
  localDispatch?: LocalDispatch
}

/**
 * Same-backend dispatch (AWTD-1553): serve a READ in-process instead of looping
 * back over HTTP. Resolve with the parsed JSON body, or null to decline. A throw
 * is not an error to the caller either: the client falls back to HTTP.
 */
export type LocalDispatch = (endpoint: string, accessToken: string) => Promise<unknown | null>

/** The flag a host checks before it supplies a LocalDispatch. Off unless set to 1/true. */
export function sameBackendDispatchEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.ASTRID_MCP_SAME_BACKEND?.trim().toLowerCase()
  return value === '1' || value === 'true'
}

/**
 * Opt-in timing of the backend hop (ADEV-314). Hosted MCP reaches the REST API over HTTP; before
 * building an in-process dispatcher, a preview run with this on shows what that hop costs.
 */
export function mcpTimingEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const value = env.ASTRID_MCP_TIMING?.trim().toLowerCase()
  return value === '1' || value === 'true'
}

export interface ClaimTaskRequest {
  action: 'claim' | 'resume' | 'release' | 'heartbeat'
  agentMailbox?: string
}

const AGENT_TASK_CLAIM_OUTCOMES = new Set([
  'claimed',
  'already_yours',
  'released',
  'renewed',
  'conflict',
  'not_ready',
  'not_found',
  'forbidden',
  'binding_denied',
])

export class OAuthAPIClient {
  private readonly baseUrl: string
  private readonly clientId: string
  private readonly clientSecret: string
  private accessToken: string | null = null
  private tokenExpiry: number = 0
  private staticAccessToken: string | null

  constructor(
    baseUrl: string = mcpDefaultBaseUrl(),
    clientId?: string,
    clientSecret?: string,
    staticAccessToken?: string | null,
    private readonly hosted = false,
    private readonly localDispatch?: LocalDispatch,
  ) {
    this.baseUrl = baseUrl
    this.clientId = clientId || process.env.ASTRID_OAUTH_CLIENT_ID || ""
    this.clientSecret = clientSecret || process.env.ASTRID_OAUTH_CLIENT_SECRET || ""
    this.staticAccessToken = staticAccessToken || null

    if (!this.staticAccessToken && (!this.clientId || !this.clientSecret)) {
      log.error("OAuth credentials not configured")
      throw new Error(
        `Provide ASTRID_OAUTH_CLIENT_ID + ASTRID_OAUTH_CLIENT_SECRET or a valid ${BRAND.appName} access token`
      )
    }
  }

  /**
   * Obtain an access token using the client-credentials flow.
   *
   * The per-instance fields are a fast path; the process-level cache is what
   * makes Basic-auth sessions cheap on the hosted /mcp endpoint, where a new
   * server (and client) is built per POST (task 11f578e0).
   */
  private async obtainAccessToken(): Promise<string> {
    if (this.staticAccessToken) {
      return this.staticAccessToken
    }

    // Check if we have a valid token
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken
    }

    const entry = await withHostedTokenCache(
      hostedTokenCacheKey(this.baseUrl, this.clientId, this.clientSecret),
      () => this.mintAccessToken()
    )
    this.accessToken = entry.accessToken
    this.tokenExpiry = entry.expiry
    return entry.accessToken
  }

  /** Exchange client credentials for a fresh token at the OAuth endpoint. */
  private async mintAccessToken(): Promise<HostedTokenEntry> {
    log.debug("Obtaining OAuth access token")

    const response = await this.fetchBackend("/api/v1/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || `HTTP ${response.status}: ${response.statusText}`)
    }

    const data: OAuthTokenResponse = await response.json()

    log.debug("Access token obtained")
    // Expire 5 minutes before the real expiry, for safety.
    return {
      accessToken: data.access_token,
      expiry: Date.now() + (data.expires_in - 300) * 1000,
    }
  }

  /**
   * Make an authenticated API request
   */
  async makeRequest<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const token = await this.obtainAccessToken()

    // Reads only: a write that threw after committing would be repeated by the fallback.
    if (this.localDispatch && (!options.method || options.method.toUpperCase() === 'GET')) {
      try {
        const local = await this.localDispatch(endpoint, token)
        if (local != null) return local as T
      } catch (error) {
        log.warn({ err: error }, 'Same-backend dispatch failed; falling back to HTTP')
      }
    }

    const startedAt = mcpTimingEnabled() ? performance.now() : null
    const response = await this.fetchBackend(endpoint, {
      ...options,
      headers: {
        ...options.headers,
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    })
    if (startedAt !== null) {
      log.info(
        { endpoint, method: options.method ?? 'GET', status: response.status, hopMs: Math.round(performance.now() - startedAt) },
        'mcp backend hop',
      )
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }))
      // A rule's refusal names its code (WAITING_NEEDS_CONDITION), so an agent can branch on it.
      // A scope refusal says which scope in `message` (AWTD-1567); "Forbidden"
      // alone would leave a scoped token's owner guessing.
      const base = error.error || `HTTP ${response.status}: ${response.statusText}`
      const message = response.status === 403 && typeof error.message === 'string' && error.message && error.message !== base
        ? `${base}: ${error.message}`
        : base
      throw new Error(typeof error.code === 'string' && error.code ? `${message} (${error.code})` : message)
    }

    return response.json()
  }

  async claimTask<T = unknown>(taskId: string, input: ClaimTaskRequest): Promise<T> {
    const token = await this.obtainAccessToken()
    const response = await this.fetchBackend(`/api/v1/tasks/${encodeURIComponent(taskId)}/claim`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    })
    const data = await response.json().catch(() => null) as { outcome?: unknown; error?: string } | null

    if (typeof data?.outcome === 'string' && AGENT_TASK_CLAIM_OUTCOMES.has(data.outcome)) {
      return data as T
    }
    if (!response.ok) {
      throw new Error(data?.error || `HTTP ${response.status}: ${response.statusText}`)
    }
    return data as T
  }

  private fetchBackend(endpoint: string, options: RequestInit): Promise<Response> {
    return this.hosted
      ? fetchMCPBackend(this.baseUrl, endpoint, options)
      : fetch(`${this.baseUrl}${endpoint}`, options)
  }
}
