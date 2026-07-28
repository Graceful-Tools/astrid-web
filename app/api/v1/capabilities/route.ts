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

export const dynamic = 'force-dynamic'

export async function GET() {
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
      brand: {
        appName: BRAND.appName,
        // No agent email domain here: clients must never construct an agent address,
        // only compare what the server returned. See AvailableAgent.isDefaultAssistant.
      },
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
