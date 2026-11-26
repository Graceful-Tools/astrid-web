/**
 * GET /api/cron/results-settle — refresh open experiment links and verifications, report the ones
 * that concluded, and settle the tasks in the Pending results column (ADEV-279).
 *
 * Auth plus a call: the pass is services/task-experiment.service.ts `runResultsSettlePass`, bounded
 * and stalest-first. For a task outside the column the pass refreshes and records the result and
 * changes nothing else; the lane rules run only for a task in the column. A deployment without Goal
 * Signals runs nothing.
 */

import { NextRequest } from 'next/server'
import { runResultsSettlePass } from '@/services/task-experiment.service'
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

  return runCronJob('results-settle', async () => {
    const summary = await runResultsSettlePass()
    return { ...summary }
  })
}
