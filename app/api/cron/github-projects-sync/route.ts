/**
 * GET /api/cron/github-projects-sync — the GitHub Projects background pass,
 * every minute (AWTD-1152, AWTD-1153; spec §8.1, §8.7).
 *
 *   - enqueue a reconcile for every board not reconciled in the last hour
 *   - drain the queue: whatever webhooks missed, jobs out of backoff, reconciles
 *   - once an hour: redeliver failed webhook deliveries, purge boards
 *     uninstalled more than 30 days ago
 *
 * A deployment without GitHub Projects answers 404 here at no cost.
 */

import { NextRequest } from 'next/server'
import { requireCronSecret } from '@/lib/cron-auth'
import { runCronJob } from '@/lib/cron-observability'
import { capabilityGate } from '@/lib/brand/capabilities'
import { RedisCache } from '@/lib/redis'
import { redeliverFailedDeliveries } from '@/lib/github/redeliver'
import { drainSyncJobs, enqueueDueReconciles } from '@/services/github-sync-jobs.service'
import { purgeDetachedBoards } from '@/services/github-projects-lifecycle.service'

export const maxDuration = 60

export async function GET(request: NextRequest) {
  const capabilityBlocked = capabilityGate('githubProjects')
  if (capabilityBlocked) return capabilityBlocked

  const blocked = requireCronSecret(request)
  if (blocked) return blocked

  return runCronJob('github-projects-sync', async () => {
    const reconcilesEnqueued = await enqueueDueReconciles()
    const drained = await drainSyncJobs(40)

    // Hourly work, once across instances: claimOnce on the hour.
    let hourly: Record<string, number> = {}
    if (await RedisCache.claimOnce(`github-projects:hourly:${Math.floor(Date.now() / 3_600_000)}`, 3_600)) {
      const { redelivered } = await redeliverFailedDeliveries()
      hourly = { redelivered, purged: await purgeDetachedBoards() }
    }
    return { reconcilesEnqueued, ...drained, ...hourly }
  })
}
