/**
 * The durable job queue (AWTD-1460): a Postgres table, generalised from
 * GitHubSyncJob (services/github-sync-jobs.service.ts).
 *
 *   enqueue   one INSERT … ON CONFLICT DO NOTHING on dedupeKey, then a drain
 *             in after() so the work starts as soon as the response is sent —
 *             the same moment the old fire-and-forget promise would have been
 *             frozen by the platform.
 *   drain     claim due jobs with a conditional UPDATE (only if unlocked or
 *             the lock has expired), run each kind's handler, record the
 *             outcome. Called after every enqueue, by the minute cron
 *             (/api/cron/reminders) and, off Vercel, by scripts/job-worker.mjs
 *             through /api/cron/jobs. A job is therefore never stranded by a
 *             killed function: its lock expires and the next drain runs it.
 *
 * Any instance drains any instance's jobs; nothing lives in process memory.
 * Handlers must be safe to run twice (a run killed after its effect but
 * before its row was marked done is re-run). See lib/jobs/kinds.ts.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { runAfterResponse } from '@/lib/background'
import { JOB_HANDLERS, type JobHandlers } from '@/lib/jobs/handlers'
import {
  DEAD_RETENTION_MS,
  DONE_RETENTION_MS,
  backoffMs,
  policyFor,
  type JobKind,
  type JobPayloads,
} from '@/lib/jobs/kinds'

const log = createLogger('jobs')

export interface EnqueueOptions {
  /** A second enqueue with the same key is a no-op while the row exists. */
  dedupeKey?: string
  runAfter?: Date
  /** Start a drain after the response (default true). Tests and the cron pass false. */
  drain?: boolean
}

export type EnqueueResult = 'queued' | 'duplicate' | 'inline'

/**
 * Queue work to run after this request, durably. Never throws: if the row
 * cannot be written (the database is down, the table is not migrated yet) the
 * work runs in after() instead, which is what these call sites did before the
 * queue existed — degraded to best-effort, never dropped.
 */
export async function enqueueJob<K extends JobKind>(
  kind: K,
  payload: JobPayloads[K],
  options: EnqueueOptions = {},
): Promise<EnqueueResult> {
  try {
    const { count } = await prisma.job.createMany({
      data: [
        {
          kind,
          payload: payload as unknown as Prisma.InputJsonValue,
          dedupeKey: options.dedupeKey ?? null,
          ...(options.runAfter ? { runAfter: options.runAfter } : {}),
        },
      ],
      skipDuplicates: true,
    })
    if (options.drain !== false) runAfterResponse('jobs-drain', () => drainJobs())
    return count > 0 ? 'queued' : 'duplicate'
  } catch (err) {
    log.error({ err, kind }, 'Could not queue job; running it after the response instead')
    const handler = JOB_HANDLERS[kind] as (p: JobPayloads[K]) => Promise<void>
    runAfterResponse(`job:${kind}`, () => handler(payload))
    return 'inline'
  }
}

export interface DrainOptions {
  limit?: number
  now?: () => Date
  /** Injected by tests; production uses JOB_HANDLERS. */
  handlers?: Partial<Record<string, (payload: never) => Promise<void>>>
}

export interface DrainSummary {
  claimed: number
  succeeded: number
  failed: number
  dead: number
}

interface ClaimedJob {
  id: string
  kind: string
  payload: Prisma.JsonValue
  attempts: number
}

export async function drainJobs(options: DrainOptions = {}): Promise<DrainSummary> {
  const limit = options.limit ?? 10
  const clock = options.now ?? (() => new Date())
  const handlers = (options.handlers ?? JOB_HANDLERS) as Partial<JobHandlers> &
    Record<string, ((payload: never) => Promise<void>) | undefined>
  const now = clock()

  const due = await prisma.job.findMany({
    where: {
      doneAt: null,
      runAfter: { lte: now },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
    },
    orderBy: { runAfter: 'asc' },
    take: limit,
    select: { id: true, kind: true, payload: true, attempts: true },
  })

  // Claim each with a conditional update: of two drainers that read the same
  // row, exactly one sees count === 1.
  const claimed: ClaimedJob[] = []
  for (const job of due) {
    const { count } = await prisma.job.updateMany({
      where: { id: job.id, doneAt: null, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
      data: { lockedUntil: new Date(now.getTime() + policyFor(job.kind).lockMs), attempts: { increment: 1 } },
    })
    if (count === 1) claimed.push({ ...job, attempts: job.attempts + 1 })
  }

  const summary: DrainSummary = { claimed: claimed.length, succeeded: 0, failed: 0, dead: 0 }
  await Promise.all(
    claimed.map(async job => {
      try {
        const handler = handlers[job.kind]
        if (!handler) throw new Error(`No handler for job kind: ${job.kind}`)
        await handler(job.payload as never)
        await prisma.job.update({
          where: { id: job.id },
          data: { doneAt: clock(), lockedUntil: null, lastError: null },
        })
        summary.succeeded++
      } catch (err) {
        summary.failed++
        const dead = job.attempts >= policyFor(job.kind).maxAttempts
        if (dead) summary.dead++
        const message = err instanceof Error ? err.message : String(err)
        const at = clock()
        try {
          await prisma.job.update({
            where: { id: job.id },
            data: {
              lockedUntil: null,
              lastError: message.slice(0, 1000),
              ...(dead ? { doneAt: at, deadAt: at } : { runAfter: new Date(at.getTime() + backoffMs(job.kind, job.attempts)) }),
            },
          })
        } catch (recordErr) {
          // The lock still expires, so the job is retried; only the error text is lost.
          log.error({ err: recordErr, jobId: job.id }, 'Could not record a job failure')
        }
        log.warn({ err, jobId: job.id, kind: job.kind, attempts: job.attempts, dead }, 'Job failed')
      }
    }),
  )
  return summary
}

/** Delete finished jobs past retention: a week for successes, a month for the dead. */
export async function purgeFinishedJobs(now: Date = new Date()): Promise<number> {
  const { count } = await prisma.job.deleteMany({
    where: {
      OR: [
        { deadAt: null, doneAt: { lt: new Date(now.getTime() - DONE_RETENTION_MS) } },
        { deadAt: { lt: new Date(now.getTime() - DEAD_RETENTION_MS) } },
      ],
    },
  })
  return count
}
