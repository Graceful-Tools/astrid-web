/**
 * GET /api/cron/goal-signals-poll — read goal metrics from outside sources (ADEV-277).
 *
 * Auth plus a call: the pass is lib/goal-signals-poll.ts, so a poll can be triggered from anywhere
 * without going through HTTP. A deployment without Goal Signals runs nothing.
 */

import { NextRequest } from 'next/server'
import { pollGoalMetrics } from '@/lib/goal-signals-poll'
import { requireCronSecret } from '@/lib/cron-auth'
import { runCronJob } from '@/lib/cron-observability'
import { capabilityGate } from '@/lib/brand/capabilities'

export const maxDuration = 60

export async function GET(request: NextRequest) {
  const capabilityBlocked = capabilityGate('goalSignals')
  if (capabilityBlocked) return capabilityBlocked

  // Fails CLOSED: no CRON_SECRET configured means nobody gets in.
  const blocked = requireCronSecret(request)
  if (blocked) return blocked

  return runCronJob('goal-signals-poll', async () => {
    const summary = await pollGoalMetrics()
    return { ...summary }
  })
}
