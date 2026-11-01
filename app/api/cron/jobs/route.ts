/**
 * GET /api/cron/jobs — drain the durable job queue once (AWTD-1460).
 *
 * Not in vercel.json: on Vercel the queue is drained by after() following each
 * enqueue and by the minute cron (/api/cron/reminders). This route is what
 * scripts/job-worker.mjs calls on a self-hosted deployment (the compose
 * `worker` service), every few seconds, so retries come due promptly there
 * too. Same secret as every cron route; fails closed without it.
 */

import { NextRequest } from 'next/server'
import { requireCronSecret } from '@/lib/cron-auth'
import { runCronJob } from '@/lib/cron-observability'
import { drainJobs } from '@/lib/jobs/queue'

export const maxDuration = 60

export async function GET(request: NextRequest) {
  const blocked = requireCronSecret(request)
  if (blocked) return blocked

  return runCronJob('jobs', async () => ({ ...(await drainJobs({ limit: 10 })) }))
}
