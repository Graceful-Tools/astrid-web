/**
 * GET /api/cron/github-projects-sync — drain the GitHub Projects sync queue
 * (AWTD-1152, spec §8.7).
 *
 * Webhooks drain the queue right after they respond; this per-minute pass
 * picks up whatever that missed — a function that ended early, a job waiting
 * out its backoff or a rate limit. A deployment without GitHub Projects
 * answers 404 here at no cost.
 */

import { NextRequest } from 'next/server'
import { requireCronSecret } from '@/lib/cron-auth'
import { runCronJob } from '@/lib/cron-observability'
import { capabilityGate } from '@/lib/brand/capabilities'
import { drainSyncJobs } from '@/services/github-sync-jobs.service'

export const maxDuration = 60

export async function GET(request: NextRequest) {
  const capabilityBlocked = capabilityGate('githubProjects')
  if (capabilityBlocked) return capabilityBlocked

  const blocked = requireCronSecret(request)
  if (blocked) return blocked

  return runCronJob('github-projects-sync', async () => ({ ...(await drainSyncJobs(40)) }))
}
