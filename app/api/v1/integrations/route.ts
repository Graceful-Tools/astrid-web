import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { prisma } from '@/lib/prisma'

/** GET /api/v1/integrations — the caller's connected sync providers. */
export const GET = withAuth(
  { scopes: ['tasks:read'], tag: 'v1.integrations' },
  async (_req, auth) => {
    const integrations = await prisma.integration.findMany({
      where: { userId: auth.userId, revokedAt: null },
      select: { provider: true, externalAccountId: true, createdAt: true },
    })
    return NextResponse.json({ integrations })
  }
)

/** DELETE /api/v1/integrations?provider=GITHUB_ISSUES — disconnect (revoke). */
export const DELETE = withAuth(
  { scopes: ['tasks:write'], tag: 'v1.integrations' },
  async (req, auth) => {
    const provider = new URL(req.url).searchParams.get('provider')
    if (provider !== 'GITHUB_ISSUES' && provider !== 'GOOGLE_TASKS') {
      return NextResponse.json({ error: 'Unknown provider' }, { status: 400 })
    }
    await prisma.integration.updateMany({
      where: { userId: auth.userId, provider },
      data: { revokedAt: new Date(), accessToken: null, refreshToken: null },
    })
    return NextResponse.json({ success: true })
  }
)
