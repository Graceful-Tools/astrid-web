import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { decryptFieldStrict, encryptField } from '@/lib/field-encryption'

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
const STATE_TAG = 'copilot' // namespaces state so it can't be replayed on another provider's callback
const STATE_TTL_MS = 10 * 60 * 1000
/** Refresh a bit before actual expiry so an in-flight call doesn't race the deadline. */
const REFRESH_SKEW_MS = 60 * 1000

export function copilotOAuthConfigured(): boolean {
  return !!(process.env.GITHUB_COPILOT_CLIENT_ID && process.env.GITHUB_COPILOT_CLIENT_SECRET)
}

// ── OAuth state (HMAC-signed, no storage; provider-tagged) ───────────────────

export function mintCopilotOAuthState(userId: string): string {
  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error('NEXTAUTH_SECRET is required to mint OAuth state')
  const expires = Date.now() + STATE_TTL_MS
  const payload = `${STATE_TAG}.${userId}.${expires}`
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex')
  return Buffer.from(`${payload}.${sig}`).toString('base64url')
}

export function verifyCopilotOAuthState(state: string): string | null {
  try {
    const secret = process.env.NEXTAUTH_SECRET
    if (!secret) return null
    const decoded = Buffer.from(state, 'base64url').toString()
    const [tag, userId, expiresStr, sig] = decoded.split('.')
    if (tag !== STATE_TAG || !userId || !expiresStr || !sig) return null
    if (Date.now() > Number(expiresStr)) return null
    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${STATE_TAG}.${userId}.${expiresStr}`)
      .digest('hex')
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
    return userId
  } catch {
    return null
  }
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
export async function exchangeCopilotCode(code: string): Promise<TokenExchange | null> {
  const res = await fetch(`${GITHUB_OAUTH}/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: process.env.GITHUB_COPILOT_CLIENT_ID,
      client_secret: process.env.GITHUB_COPILOT_CLIENT_SECRET,
      code,
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

/** True if the user has a live (non-revoked) Copilot credential. */
export async function hasCopilotCredential(userId: string): Promise<boolean> {
  const cred = await prisma.copilotCredential.findUnique({ where: { userId } })
  return !!cred && !cred.revokedAt
}

/**
 * Return a usable access token for the user, refreshing transparently when it
 * has expired and a refresh token is on file. Returns null when disconnected,
 * revoked, or expired-with-no-refresh (caller should prompt re-auth).
 */
export async function copilotTokenFor(userId: string): Promise<string | null> {
  const cred = await prisma.copilotCredential.findUnique({ where: { userId } })
  if (!cred?.accessToken || cred.revokedAt) return null

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
