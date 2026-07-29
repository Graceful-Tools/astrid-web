/**
 * GET /api/v1/capabilities — what this deployment actually offers.
 *
 * Task 97208a72. Capabilities are a property of the SERVER, not of the client build:
 * one iOS/Mac binary can point at different deployments (the DEBUG server picker does
 * exactly that), so a client cannot know at compile time whether Google Tasks sync
 * exists. It asks.
 *
 * Clients use this to hide entry points for services the server does not serve. It is
 * presentation only — every capability is enforced server-side on its own routes, so a
 * client that ignores this response gains nothing but 404s.
 *
 * Unauthenticated on purpose: this is the same information the sign-in page and
 * /llms.txt already disclose, it is constant per deployment, and requiring a session
 * would stop the client configuring itself before the user signs in — which is exactly
 * when it needs to know which sign-in methods to show.
 */
import { NextResponse } from 'next/server'
import { CAPABILITIES } from '@/lib/brand/capabilities'
import { BRAND } from '@/lib/brand/config'
import { BRAND_COPY } from '@/lib/brand/copy'

export const dynamic = 'force-dynamic'

export async function GET() {
  // Included ONLY when this deployment actually overrides the voice. Astrid overrides
  // nothing, so the common case adds no bytes at all and clients keep their built-in
  // set — the endpoint carries what DIFFERS, not the whole voice. Task 97208a72.
  const hasBrandCopy = Object.keys(BRAND_COPY).length > 0

  return NextResponse.json(
    {
      // Grouped by concern so a client can consume one area without knowing every key.
      auth: {
        google: CAPABILITIES.authGoogle,
        apple: CAPABILITIES.authApple,
        passkey: CAPABILITIES.authPasskey,
      },
      sync: {
        googleTasks: CAPABILITIES.syncGoogleTasks,
        githubIssues: CAPABILITIES.syncGithubIssues,
      },
      integrations: {
        mcp: CAPABILITIES.integrationMcp,
        openclaw: CAPABILITIES.integrationOpenClaw,
        chatgptActions: CAPABILITIES.integrationChatGptActions,
      },
      services: {
        emailToTask: CAPABILITIES.emailToTask,
        calendarFeed: CAPABILITIES.calendarFeed,
      },
      // The brand this deployment presents itself as. TEXT ONLY, and deliberately so:
      // one mobile binary can point at several deployments, so the brand cannot be a
      // purely build-time value on the client any more than the capability set could be.
      //
      // No `domain` or `agentEmailDomain`: those are client-side trust boundaries. A
      // server telling a client which domain is "its" brand would be telling it which
      // cookies to clear and which Universal Links to claim. Clients must never
      // construct an agent address either — only compare what the server returned. See
      // AvailableAgent.isDefaultAssistant.
      //
      // No `accentColor`: the clients resolve colours once at launch so no render ever
      // parses a hex string, and a server-driven accent would cost that on every colour
      // read. Colour stays build-time on both sides.
      brand: {
        appName: BRAND.appName,
        wordmark: BRAND.wordmark,
        slogan: BRAND.slogan,
        agentName: BRAND.agentIdentityName,
      },
      // The brand's VOICE — reminder nags and default-list captions. Native clients
      // shipped their own copy of Astrid's set, so a partner had to replace it once per
      // platform with nothing keeping the copies in step. Served here so it is
      // configured exactly once, in the brand profile.
      ...(hasBrandCopy ? { copy: BRAND_COPY } : {}),
      meta: { apiVersion: 'v1' as const },
    },
    {
      headers: {
        // Constant per deployment, but short-lived so a capability change is picked up
        // without waiting out a long cache.
        'Cache-Control': 'public, max-age=300',
      },
    }
  )
}
