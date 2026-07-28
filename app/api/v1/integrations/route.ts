import { hasCapability } from '@/lib/brand/capabilities'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { prisma } from '@/lib/prisma'

/**
 * Sync providers this deployment supports. A provider disabled at build time must be
 * rejected here too — the per-provider routes are guarded, but this endpoint takes the
 * provider as *input*, so without this check a caller could still write settings for,
 * or connect against, a provider the deployment does not offer. Task 97208a72.
 */
const PROVIDER_CAPABILITY = {
  GITHUB_ISSUES: 'syncGithubIssues',
  GOOGLE_TASKS: 'syncGoogleTasks',
} as const

type SyncProvider = keyof typeof PROVIDER_CAPABILITY

function isEnabledProvider(provider: unknown): provider is SyncProvider {
  return (
    typeof provider === 'string' &&
    provider in PROVIDER_CAPABILITY &&
    hasCapability(PROVIDER_CAPABILITY[provider as SyncProvider])
  )
}

/** GET /api/v1/integrations — the caller's connected sync providers. */
export const GET = withAuth(
  { scopes: ['tasks:read'], tag: 'v1.integrations' },
  async (_req, auth) => {
    const integrations = await prisma.integration.findMany({
      where: { userId: auth.userId, revokedAt: null },
      select: { provider: true, externalAccountId: true, createdAt: true, metadata: true },
    })
    return NextResponse.json({ integrations })
  }
)

/**
 * PATCH /api/v1/integrations — update a provider's sync settings.
 * Body: { provider, metadata } — metadata is merged over the existing value
 * (client settings like googleSyncMode / listSuffix live here so they follow
 * the account across devices).
 */
export const PATCH = withAuth(
  { scopes: ['tasks:write'], tag: 'v1.integrations' },
  async (req, auth) => {
    const body = await req.json().catch(() => null)
    const { provider, metadata } = body || {}
    if (!isEnabledProvider(provider) || typeof metadata !== 'object' || !metadata) {
      return NextResponse.json({ error: 'provider and metadata object required' }, { status: 400 })
    }
    const existing = await prisma.integration.findUnique({
      where: { userId_provider: { userId: auth.userId, provider } },
    })
    if (!existing || existing.revokedAt) {
      return NextResponse.json({ error: 'Not connected' }, { status: 404 })
    }
    const merged = { ...(existing.metadata as object || {}), ...metadata }
    await prisma.integration.update({ where: { id: existing.id }, data: { metadata: merged } })
    return NextResponse.json({ success: true, metadata: merged })
  }
)

/** DELETE /api/v1/integrations?provider=GITHUB_ISSUES — disconnect (revoke). */
export const DELETE = withAuth(
  { scopes: ['tasks:write'], tag: 'v1.integrations' },
  async (req, auth) => {
    const provider = new URL(req.url).searchParams.get('provider')
    if (!isEnabledProvider(provider)) {
      return NextResponse.json({ error: 'Unknown provider' }, { status: 400 })
    }
    await prisma.integration.updateMany({
      where: { userId: auth.userId, provider },
      data: { revokedAt: new Date(), accessToken: null, refreshToken: null },
    })
    return NextResponse.json({ success: true })
  }
)
