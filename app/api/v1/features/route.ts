/**
 * GET /api/v1/features — the caller's effective feature flags.
 *
 * Was session-only (`getUnifiedSession`), which meant **iOS could not read its
 * own flags at all**: the app authenticates with OAuth, so every request
 * returned 401. Project Mode is granted per user by an admin, so without this
 * the phone had no way to discover whether the signed-in user has it, and could
 * not gate the Projects UI on server config (AWTD-566).
 *
 * `withAuth` accepts both an OAuth token and a NextAuth session, so the web
 * client keeps working unchanged and iOS starts working.
 *
 * Pairs with GET /api/v1/capabilities:
 *   capabilities → does this DEPLOYMENT ship the feature at all
 *   features     → does THIS USER have it
 *
 * A client needs both. Capability false means hide the surface entirely;
 * capability true with the flag false means show the request-access affordance.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { getEffectiveFeatures } from '@/lib/feature-flags'

export const dynamic = 'force-dynamic'

export const GET = withAuth(
  // No scope required. This is the caller's own flag set, and gating it behind
  // a scope would mean a token issued before the scope existed could not learn
  // what it is allowed to do — the opposite of what this endpoint is for.
  { scopes: [], tag: 'v1.features' },
  async (req, auth) => {
    const effective = await getEffectiveFeatures(auth.userId)

    const etag = `"features-${effective.version}-${Object.values(effective.features).map(Number).join('')}"`
    if (req.headers.get('if-none-match') === etag) {
      return new NextResponse(null, { status: 304, headers: { ETag: etag } }) as never
    }

    return NextResponse.json(effective, {
      headers: {
        ETag: etag,
        // Per-user, so it must never land in a shared cache.
        'Cache-Control': 'private, no-cache',
      },
    })
  }
)
