/**
 * GitHub Installations API (legacy, session auth).
 *
 * Twin of GET /api/v1/github/installations, over the same implementation:
 * the installations the user can act on, from the installation model
 * (AWTD-1111/AWTD-1114). An installation appears only if the user has an
 * access row, which only GitHub's own answer grants (AWTD-1087) — so
 * installations nobody linked are never offered here.
 *
 * It used to ask GitHub about each linked installation on every call, for a
 * settings component that is gone; nothing in the web or native apps calls it
 * now, and it stays only as the session-auth twin.
 */

import { NextResponse } from 'next/server'
import { getUnifiedSession } from '@/lib/session-utils'
import { createLogger } from '@/lib/logger'
import { capabilityGate } from '@/lib/brand/capabilities'
import { installationSummariesForUser } from '@/lib/github/installations'

const log = createLogger('github.installations')

export async function GET() {
  // A deployment without the coding agent must refuse
  // server-side, not merely hide the UI (task 229c175c).
  const capabilityBlocked = capabilityGate('codingAgent')
  if (capabilityBlocked) return capabilityBlocked

  try {
    const session = await getUnifiedSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ installations: await installationSummariesForUser(session.user.id) })
  } catch (error) {
    log.error({ err: error }, 'Error fetching GitHub installations:')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
