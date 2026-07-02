import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { decryptField, encryptField } from '@/lib/field-encryption'

/**
 * GitHub Issues sync — server-side helpers.
 *
 * The CLIENT executes the sync (pull/push through the /api/v1/sync/github
 * proxy); the server only stores credentials + links and forwards requests so
 * OAuth tokens never leave the server. Requires env:
 *   GITHUB_SYNC_CLIENT_ID / GITHUB_SYNC_CLIENT_SECRET  (OAuth app, scope: repo)
 *   GITHUB_SYNC_WEBHOOK_SECRET                          (issues webhook nudge)
 */

const GITHUB_API = 'https://api.github.com'

export function githubSyncConfigured(): boolean {
  return !!(process.env.GITHUB_SYNC_CLIENT_ID && process.env.GITHUB_SYNC_CLIENT_SECRET)
}

// ── OAuth state (HMAC-signed, no storage) ───────────────────────────────────

export function mintOAuthState(userId: string): string {
  const secret = process.env.NEXTAUTH_SECRET || ''
  const expires = Date.now() + 10 * 60 * 1000
  const payload = `${userId}.${expires}`
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex')
  return Buffer.from(`${payload}.${sig}`).toString('base64url')
}

export function verifyOAuthState(state: string): string | null {
  try {
    const secret = process.env.NEXTAUTH_SECRET || ''
    const decoded = Buffer.from(state, 'base64url').toString()
    const [userId, expiresStr, sig] = decoded.split('.')
    if (!userId || !expiresStr || !sig) return null
    if (Date.now() > Number(expiresStr)) return null
    const expected = crypto.createHmac('sha256', secret).update(`${userId}.${expiresStr}`).digest('hex')
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
    return userId
  } catch {
    return null
  }
}

// ── Token access ─────────────────────────────────────────────────────────────

export async function githubTokenFor(userId: string): Promise<string | null> {
  const integration = await prisma.integration.findUnique({
    where: { userId_provider: { userId, provider: 'GITHUB_ISSUES' } },
  })
  if (!integration?.accessToken || integration.revokedAt) return null
  try {
    return decryptField(integration.accessToken)
  } catch {
    return null
  }
}

export async function storeGithubIntegration(userId: string, accessToken: string, login: string, scopes: string[]) {
  return prisma.integration.upsert({
    where: { userId_provider: { userId, provider: 'GITHUB_ISSUES' } },
    create: {
      userId,
      provider: 'GITHUB_ISSUES',
      accessToken: encryptField(accessToken),
      externalAccountId: login,
      scopes,
    },
    update: {
      accessToken: encryptField(accessToken),
      externalAccountId: login,
      scopes,
      revokedAt: null,
    },
  })
}

// ── GitHub REST proxy calls ──────────────────────────────────────────────────

export async function githubRequest(
  token: string,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => null)
  return { status: res.status, json }
}

export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.GITHUB_SYNC_WEBHOOK_SECRET
  if (!secret || !signature) return false
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  } catch {
    return false
  }
}
