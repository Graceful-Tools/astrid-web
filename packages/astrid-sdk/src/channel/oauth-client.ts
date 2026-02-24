import type { AstridChannelConfig } from './types.js'

/**
 * OAuth2 client_credentials flow with token caching and auto-refresh.
 */
export class OAuthClient {
  private accessToken: string | null = null
  private expiresAt = 0

  constructor(private config: AstridChannelConfig) {}

  /** Get a valid token, refreshing if needed (5 min buffer). */
  async ensureToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.expiresAt - 300_000) {
      return this.accessToken
    }
    return this.refreshToken()
  }

  /** Force-refresh the token. */
  async refreshToken(): Promise<string> {
    const endpoint = this.config.tokenEndpoint
      || `${this.config.apiBase || 'https://www.astrid.cc/api/v1'}/oauth/token`

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        scope: 'tasks:read tasks:write comments:read comments:write sse:connect',
      }),
    })

    if (!res.ok) {
      throw new Error(`OAuth token request failed: ${res.status} ${res.statusText}`)
    }

    const data: any = await res.json()
    this.accessToken = data.access_token
    this.expiresAt = Date.now() + (data.expires_in * 1000)
    return this.accessToken!
  }
}
