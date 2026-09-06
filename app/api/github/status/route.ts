/**
 * GitHub Connection Status API (legacy)
 * Checks if user has complete GitHub + AI setup
 *
 * The payload is built by lib/github-status.ts and shared with the v1 route.
 * This handler owns only session auth. (Task e0613ae5.)
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUnifiedSession } from '@/lib/session-utils'
import { getGitHubStatus } from '@/lib/github-status'
import { createLogger } from '@/lib/logger'
import { capabilityGate } from '@/lib/brand/capabilities'

const log = createLogger('github.status')

export async function GET(request: NextRequest) {
  // A deployment with the GitHub integration disabled must refuse
  // server-side, not merely hide the UI (task 229c175c).
  const capabilityBlocked = capabilityGate('syncGithubIssues')
  if (capabilityBlocked) return capabilityBlocked

  try {
    const session = await getUnifiedSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const status = await getGitHubStatus(session.user.id, 'github/status')

    log.info(
      {
        userId: session.user.id,
        isGitHubConnected: status.isGitHubConnected,
        userApiKeys: status.userApiKeys,
        availableProviders: status.aiProviders,
      },
      '[GitHub Status] Checked status for user',
    )

    return NextResponse.json(status)
  } catch (error) {
    log.error({ err: error }, 'Error checking GitHub status:')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
