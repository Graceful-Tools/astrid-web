import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { decryptFieldStrict, encryptField } from '@/lib/field-encryption'
import { ENABLED_AGENT_MAILBOXES } from '@/lib/ai/agent-config'
import { mintOAuthState, verifyOAuthState } from '@/lib/sync/oauth-state'

/**
 * GitHub Copilot per-user OAuth — server-side helpers.
 *
 * Phase 1 of the sanctioned Copilot integration (see
 * docs/COPILOT_SDK_INTEGRATION_PLAN.md): capture a per-user GitHub OAuth token
 * so inference bills against that user's Copilot entitlement. Mirrors the
 * Issues-sync OAuth pattern
 * (lib/sync/github.ts) but stores to the dedicated CopilotCredential model and
 * supports refresh (GitHub App expiring tokens).
 *
 * Requires env:
 *   GITHUB_COPILOT_CLIENT_ID / GITHUB_COPILOT_CLIENT_SECRET   (OAuth or GitHub App)
 *
 * GitHub's supported Copilot SDK OAuth flow uses a standard OAuth/GitHub App
 * user token; no broad repository scope is requested by Astrid.
 */

const GITHUB_OAUTH = 'https://github.com/login/oauth'
const GITHUB_API = 'https://api.github.com'
/** Refresh a bit before actual expiry so an in-flight call doesn't race the deadline. */
const REFRESH_SKEW_MS = 60 * 1000

export function copilotOAuthConfigured(): boolean {
  return !!(process.env.GITHUB_COPILOT_CLIENT_ID && process.env.GITHUB_COPILOT_CLIENT_SECRET)
}

/**
 * Does this deployment offer the Copilot integration at all?
 *
 * A brand that leaves `copilot` out of BRAND_ENABLED_AGENTS has no Copilot
 * agent, so its authorize/callback/status routes must refuse rather than mint
 * OAuth state for an identity that does not exist here. The routes were
 * reachable regardless of the brand's agent set (task 229c175c).
 */
export function copilotIntegrationEnabled(): boolean {
  return ENABLED_AGENT_MAILBOXES.includes('copilot')
}

/**
 * 404 for a deployment without the Copilot integration, or null to continue.
 * Matches capabilityGate's shape and its absent-not-forbidden reasoning.
 */
export function copilotIntegrationGate(): NextResponse | null {
  if (copilotIntegrationEnabled()) return null
  return NextResponse.json({ error: 'Not found' }, { status: 404 })
}

// ── OAuth state ──────────────────────────────────────────────────────────────
// The provider-tagged HMAC state started here and is now shared with the GitHub
// and Google connect flows, which were minting an untagged one (task 842601f2).
// The wire format is unchanged: `copilot.<userId>.<expires>.<sig>`.

export function mintCopilotOAuthState(userId: string): string {
  return mintOAuthState(userId, 'copilot')
}

export function verifyCopilotOAuthState(state: string): string | null {
  return verifyOAuthState(state, 'copilot')
}

// ── Token exchange ───────────────────────────────────────────────────────────

interface TokenExchange {
  accessToken: string
  refreshToken?: string
  /** Absolute expiry, when GitHub returns expires_in (GitHub App tokens). */
  expiresAt?: Date
  scopes: string[]
}

function parseTokenResponse(json: any): TokenExchange | null {
  const accessToken = json?.access_token as string | undefined
  if (!accessToken) return null
  const expiresIn = typeof json?.expires_in === 'number' ? json.expires_in : undefined
  return {
    accessToken,
    refreshToken: (json?.refresh_token as string | undefined) || undefined,
    expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : undefined,
    scopes: (json?.scope as string | undefined)?.split(',').filter(Boolean) ?? [],
  }
}

/** Exchange an authorization code for a user access token. */
/**
 * `redirectUri` is required when the code was issued against one — GitHub
 * checks it matches — and omitted for the browser flow, which registers a
 * single callback URL. The app-completed link passes the app's own scheme
 * (task 842601f2).
 */
export async function exchangeCopilotCode(code: string, redirectUri?: string): Promise<TokenExchange | null> {
  const res = await fetch(`${GITHUB_OAUTH}/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: process.env.GITHUB_COPILOT_CLIENT_ID,
      client_secret: process.env.GITHUB_COPILOT_CLIENT_SECRET,
      code,
      ...(redirectUri ? { redirect_uri: redirectUri } : {}),
    }),
  })
  const json = await res.json().catch(() => null)
  return parseTokenResponse(json)
}

/** Exchange a refresh token for a fresh access token (GitHub App expiring tokens). */
async function refreshCopilotToken(refreshToken: string): Promise<TokenExchange | null> {
  const res = await fetch(`${GITHUB_OAUTH}/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: process.env.GITHUB_COPILOT_CLIENT_ID,
      client_secret: process.env.GITHUB_COPILOT_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })
  const json = await res.json().catch(() => null)
  return parseTokenResponse(json)
}

/** Look up the GitHub login for identity mapping (best-effort). */
export async function githubLoginFor(accessToken: string): Promise<string | null> {
  const res = await fetch(`${GITHUB_API}/user`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (res.status !== 200) return null
  const json = await res.json().catch(() => null)
  return (json?.login as string | undefined) ?? null
}

// ── Persistence ──────────────────────────────────────────────────────────────

export async function storeCopilotCredential(
  userId: string,
  token: TokenExchange,
  githubLogin: string | null,
) {
  const data = {
    accessToken: encryptField(token.accessToken),
    refreshToken: token.refreshToken ? encryptField(token.refreshToken) : null,
    expiresAt: token.expiresAt ?? null,
    scopes: token.scopes,
    githubLogin,
    revokedAt: null as Date | null,
  }
  return prisma.copilotCredential.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  })
}

export async function revokeCopilotCredential(userId: string) {
  await prisma.copilotCredential.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

/**
 * A GitHub token the user pasted into settings, stored in the same encrypted
 * vault as the other providers' API keys.
 *
 * Copilot entitlement follows the user's Copilot subscription rather than the
 * OAuth app that minted the token, so an ordinary GitHub token (e.g. the output
 * of `gh auth token`) authenticates against the Copilot API. This keeps Copilot
 * usable on servers where no GitHub OAuth App has been registered.
 */
async function pastedCopilotToken(userId: string): Promise<string | null> {
  const { getCachedApiKey } = await import('@/lib/api-key-cache')
  return getCachedApiKey(userId, 'copilot')
}

/**
 * True if the user has a live Copilot credential from either source.
 *
 * This gates whether Copilot appears in the agent picker
 * (lib/ai/orchestrator/factory.ts and both github/status routes), so it must
 * agree with copilotTokenFor — otherwise Copilot authenticates but stays hidden.
 */
export async function hasCopilotCredential(userId: string): Promise<boolean> {
  const cred = await prisma.copilotCredential.findUnique({ where: { userId } })
  if (cred && !cred.revokedAt) return true
  return !!(await pastedCopilotToken(userId))
}

/**
 * Return a usable access token for the user, refreshing transparently when it
 * has expired and a refresh token is on file. Prefers a connected OAuth account
 * and falls back to a pasted token. Returns null when neither source has one.
 */
export async function copilotTokenFor(userId: string): Promise<string | null> {
  const cred = await prisma.copilotCredential.findUnique({ where: { userId } })
  if (!cred?.accessToken || cred.revokedAt) return pastedCopilotToken(userId)

  const expired = !!cred.expiresAt && cred.expiresAt.getTime() - REFRESH_SKEW_MS <= Date.now()
  if (expired) {
    if (!cred.refreshToken) return null // OAuth-App tokens don't expire; a set expiry with no refresh = re-auth
    let refreshTokenPlain: string | null
    try {
      refreshTokenPlain = decryptFieldStrict(cred.refreshToken)
    } catch {
      return null
    }
    if (!refreshTokenPlain) return null
    const refreshed = await refreshCopilotToken(refreshTokenPlain)
    if (!refreshed) return null
    await storeCopilotCredential(userId, refreshed, cred.githubLogin)
    return refreshed.accessToken
  }

  try {
    return decryptFieldStrict(cred.accessToken)
  } catch {
    return null
  }
}
