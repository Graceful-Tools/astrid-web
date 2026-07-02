import { type NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { mintOAuthState } from '@/lib/sync/github'
import { googleAuthorizeURL, googleSyncConfigured } from '@/lib/sync/google'

/** GET — returns the Google OAuth URL (HMAC state; offline access for refresh). */
export const GET = withAuth(
  { scopes: ['tasks:write'], tag: 'v1.integrations.google' },
  async (req: NextRequest, auth) => {
    if (!googleSyncConfigured()) {
      return NextResponse.json({ error: 'Google Tasks sync is not configured on this server' }, { status: 503 })
    }
    const origin = new URL(req.url).origin
    const redirectUri = `${origin}/api/v1/integrations/google/callback`
    return NextResponse.json({ url: googleAuthorizeURL(mintOAuthState(auth.userId), redirectUri) })
  }
)
