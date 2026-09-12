/**
 * GET /api/v1/app-version?platform=ios|mac — what is released on the store.
 *
 * The backend half of AWTD-920 / iOS AITD-383. The iOS and Mac Update card is
 * already merged and is deliberately invisible until this answers: the clients
 * treat every failure, and every response without a `latestVersion` and
 * `updateUrl`, as "no update known". So this endpoint is the switch, and the
 * table in lib/app-version.ts is what it switches on.
 *
 * PLATFORM IS REQUIRED AND NEVER GUESSED. The two apps version independently,
 * so answering the wrong one's number would nag whichever app is behind the
 * other — on every launch, since the client checks once per launch. A missing
 * or unknown platform is a 400 rather than a default.
 *
 * Authenticated like the rest of /api/v1, with no scopes: the wrapper allows
 * any authenticated caller, and the client sends its normal session. Unlike
 * /api/v1/capabilities this is not needed before sign-in, so there is no
 * reason to widen it.
 */
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { APP_PLATFORMS, appVersionFor, parseAppPlatform } from '@/lib/app-version'

export const dynamic = 'force-dynamic'

export const GET = withAuth(
  { scopes: [], tag: 'v1.app-version' },
  async request => {
    const { searchParams } = new URL(request.url)
    const platform = parseAppPlatform(searchParams.get('platform'))

    if (!platform) {
      return NextResponse.json(
        { error: `platform must be one of: ${APP_PLATFORMS.join(', ')}` },
        { status: 400 },
      )
    }

    // Absent fields are omitted, not null: every field decodes as optional on
    // the client, so the smallest honest answer is an empty object.
    return NextResponse.json(appVersionFor(platform))
  },
)
