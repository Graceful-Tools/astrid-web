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
    staticAccessToken?: string | null
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

    const response = await fetch(`${this.baseUrl}/api/v1/oauth/token`, {
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

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        ...options.headers,
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }))
      throw new Error(error.error || `HTTP ${response.status}: ${response.statusText}`)
    }

    return response.json()
  }
}
