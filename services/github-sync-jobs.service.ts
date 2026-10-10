/**
 * The GitHub sync job queue (AWTD-1152, P4d). Spec §8.1, §8.7.
 *
 *   enqueue   one INSERT … ON CONFLICT DO NOTHING on dedupeKey — the webhook's
 *             whole cost (§13.3: ack ≤ 300ms)
 *   drain     claim due jobs fairly (lib/github/projects/jobs.ts), run them,
 *             record the outcome. Called after a webhook's response and by the
 *             per-minute cron, so a job is never stranded by a missed waitUntil.
 *
 * Claiming is a conditional UPDATE per job (only if unlocked or its lock has
 * expired), so two drainers never run the same job. A job is idempotent by
 * construction — hydration re-reads GitHub and apply compares values — so a
 * job that runs twice after a crash is harmless.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import {
  LOCK_MS,
  MAX_ATTEMPTS,
  backoffMs,
  hydrateDedupeKey,
  pickRoundRobin,
  type HydratePayload,
} from '@/lib/github/projects/jobs'
import { hydrateItem } from '@/lib/github/projects/hydrate'
import { installationGraphqlClient } from '@/lib/github/graphql-clients'
import type { GraphqlClient } from '@/lib/github/rate-limiter'
import { applyProjectItems, boardForProjectNode, removeProjectItem } from '@/services/github-projects.service'

const log = createLogger('services.github-sync-jobs')

export async function enqueueHydrate(args: {
  installationId: number
  itemNodeId: string
  projectNodeId: string
  now?: number
}): Promise<boolean> {
  const payload: HydratePayload = { itemNodeId: args.itemNodeId, projectNodeId: args.projectNodeId }
  const { count } = await prisma.gitHubSyncJob.createMany({
    data: [
      {
        kind: 'hydrate',
        installationId: args.installationId,
        dedupeKey: hydrateDedupeKey(args.itemNodeId, args.now ?? Date.now()),
        payload: payload as unknown as Prisma.InputJsonValue,
      },
    ],
    skipDuplicates: true,
  })
  return count > 0
}

interface ClaimedJob {
  id: string
  kind: string
  installationId: number
  payload: Prisma.JsonValue
  attempts: number
}

export interface DrainDeps {
  now?: () => Date
  clientFor?: (installationId: number) => GraphqlClient
}

/** Run one hydrate job: GitHub's current state onto every board of that project. */
async function runHydrate(job: ClaimedJob, client: GraphqlClient): Promise<void> {
  const { itemNodeId, projectNodeId } = job.payload as unknown as HydratePayload
  const board = await boardForProjectNode(projectNodeId)
  if (!board) return // not (or no longer) bound: nothing to mirror into

  const item = await hydrateItem(client, itemNodeId)
  if (item) await applyProjectItems(board, [item])
  else await removeProjectItem(board, itemNodeId) // deleted on GitHub, or no longer visible
}

export interface DrainSummary {
  claimed: number
  succeeded: number
  failed: number
}

export async function drainSyncJobs(limit = 20, deps: DrainDeps = {}): Promise<DrainSummary> {
  const now = deps.now?.() ?? new Date()
  const clientFor = deps.clientFor ?? (id => installationGraphqlClient(id, 'hydrate'))

  const due = await prisma.gitHubSyncJob.findMany({
    where: {
      doneAt: null,
      runAfter: { lte: now },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
    },
    orderBy: { runAfter: 'asc' },
    take: limit * 5,
    select: { id: true, kind: true, installationId: true, payload: true, attempts: true },
  })

  const picked = pickRoundRobin(due, limit)
  const claimed: ClaimedJob[] = []
  for (const job of picked) {
    const { count } = await prisma.gitHubSyncJob.updateMany({
      where: { id: job.id, doneAt: null, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
      data: { lockedUntil: new Date(now.getTime() + LOCK_MS), attempts: { increment: 1 } },
    })
    if (count === 1) claimed.push({ ...job, attempts: job.attempts + 1 })
  }

  const summary: DrainSummary = { claimed: claimed.length, succeeded: 0, failed: 0 }
  await Promise.all(
    claimed.map(async job => {
      try {
        if (job.kind !== 'hydrate') throw new Error(`Unknown sync job kind: ${job.kind}`)
        await runHydrate(job, clientFor(job.installationId))
        await prisma.gitHubSyncJob.update({
          where: { id: job.id },
          data: { doneAt: new Date(), lockedUntil: null, error: null },
        })
        summary.succeeded++
      } catch (err) {
        summary.failed++
        const message = err instanceof Error ? err.message : String(err)
        const retryAfterMs =
          err instanceof Error && err.name === 'GitHubRateLimitedError'
            ? (err as Error & { retryAfterMs: number }).retryAfterMs
            : backoffMs(job.attempts)
        const dead = job.attempts >= MAX_ATTEMPTS
        await prisma.gitHubSyncJob.update({
          where: { id: job.id },
          data: {
            lockedUntil: null,
            error: message.slice(0, 1000),
            ...(dead ? { doneAt: new Date() } : { runAfter: new Date(Date.now() + retryAfterMs) }),
          },
        })
        log.warn({ jobId: job.id, attempts: job.attempts, dead, err }, 'GitHub sync job failed')
      }
    }),
  )
  return summary
}
