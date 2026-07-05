import { prisma } from '@/lib/prisma'
import { decryptFieldStrict, encryptField } from '@/lib/field-encryption'

/**
 * Google Tasks sync — server-side helpers (mirrors lib/sync/github.ts).
 * Uses GOOGLE_SYNC_CLIENT_ID / GOOGLE_SYNC_CLIENT_SECRET when set, falling
 * back to the login/contacts client (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) —
 * one Google OAuth client serves all flows; the sync just adds the tasks scope
 * and its own redirect URI.
 * (OAuth client, scope https://www.googleapis.com/auth/tasks).
 * Google access tokens expire (~1h): refresh-on-use with the stored
 * refresh token; tokens never leave the server.
 */

const TASKS_API = 'https://tasks.googleapis.com/tasks/v1'

function googleClientId(): string | undefined {
  return process.env.GOOGLE_SYNC_CLIENT_ID || process.env.GOOGLE_CLIENT_ID
}

function googleClientSecret(): string | undefined {
  return process.env.GOOGLE_SYNC_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET
}

export function googleSyncConfigured(): boolean {
  return !!(googleClientId() && googleClientSecret())
}

export function googleAuthorizeURL(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: googleClientId()!,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/tasks',
    access_type: 'offline',   // refresh token
    prompt: 'consent',        // always return a refresh token
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

export async function exchangeGoogleCode(code: string, redirectUri: string) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: googleClientId()!,
      client_secret: googleClientSecret()!,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  return res.json() as Promise<{
    access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string
  }>
}

export async function storeGoogleIntegration(
  userId: string, accessToken: string, refreshToken: string | undefined, expiresIn: number | undefined, email: string | null
) {
  const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null
  return prisma.integration.upsert({
    where: { userId_provider: { userId, provider: 'GOOGLE_TASKS' } },
    create: {
      userId, provider: 'GOOGLE_TASKS',
      accessToken: encryptField(accessToken),
      refreshToken: refreshToken ? encryptField(refreshToken) : null,
      expiresAt, externalAccountId: email,
      scopes: ['https://www.googleapis.com/auth/tasks'],
    },
    update: {
      accessToken: encryptField(accessToken),
      ...(refreshToken ? { refreshToken: encryptField(refreshToken) } : {}),
      expiresAt, externalAccountId: email, revokedAt: null,
    },
  })
}

/** Valid access token for the user, refreshing (and persisting) if expired. */
export async function googleTokenFor(userId: string): Promise<string | null> {
  const integration = await prisma.integration.findUnique({
    where: { userId_provider: { userId, provider: 'GOOGLE_TASKS' } },
  })
  if (!integration?.accessToken || integration.revokedAt) return null

  const notExpired = integration.expiresAt && integration.expiresAt.getTime() > Date.now() + 60_000
  if (notExpired) {
    try { return decryptFieldStrict(integration.accessToken) } catch { return null }
  }

  // Refresh
  if (!integration.refreshToken) return null
  let refreshToken: string | null = null
  try { refreshToken = decryptFieldStrict(integration.refreshToken) } catch { return null }
  if (!refreshToken) return null
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: googleClientId()!,
      client_secret: googleClientSecret()!,
      grant_type: 'refresh_token',
    }),
  })
  const json = await res.json().catch(() => null) as { access_token?: string; expires_in?: number } | null
  if (!json?.access_token) return null
  await prisma.integration.update({
    where: { id: integration.id },
    data: {
      accessToken: encryptField(json.access_token),
      expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : null,
    },
  })
  return json.access_token
}

export async function googleRequest(
  token: string, method: string, path: string, body?: unknown
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${TASKS_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => null)
  return { status: res.status, json }
}
