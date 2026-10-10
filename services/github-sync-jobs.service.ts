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
  RECONCILE_INTERVAL_MS,
  accessDedupeKey,
  backoffMs,
  hydrateDedupeKey,
  pickRoundRobin,
  reconcileDedupeKey,
  type AccessPayload,
  type HydratePayload,
  type ReconcilePayload,
  type SyncJobKind,
} from '@/lib/github/projects/jobs'
import { hydrateItem } from '@/lib/github/projects/hydrate'
import { installationGraphqlClient, userGraphqlClient } from '@/lib/github/graphql-clients'
import type { GraphqlClient } from '@/lib/github/rate-limiter'
import { applyProjectItems, boardForProjectNode, removeProjectItem } from '@/services/github-projects.service'
import { reconcileProject, syncBoardRoles } from '@/services/github-projects-lifecycle.service'
import { boundBoard } from '@/services/github-projects.service'
import { ADD_ITEM_DOCUMENT, planInitialFields, type CreatedContent } from '@/lib/github/projects/create'

const log = createLogger('services.github-sync-jobs')

async function enqueue(kind: SyncJobKind, installationId: number, dedupeKey: string, payload: object): Promise<boolean> {
  const { count } = await prisma.gitHubSyncJob.createMany({
    data: [{ kind, installationId, dedupeKey, payload: payload as Prisma.InputJsonValue }],
    skipDuplicates: true,
  })
  return count > 0
}

export function enqueueHydrate(args: {
  installationId: number
  itemNodeId: string
  projectNodeId: string
  now?: number
}): Promise<boolean> {
  const payload: HydratePayload = { itemNodeId: args.itemNodeId, projectNodeId: args.projectNodeId }
  return enqueue('hydrate', args.installationId, hydrateDedupeKey(args.itemNodeId, args.now ?? Date.now()), payload)
}

/** Refresh board roles for everyone in an installation (org membership changed). */
export function enqueueAccessRefresh(installationId: number, now = Date.now()): Promise<boolean> {
  const payload: AccessPayload = { installationId }
  return enqueue('access', installationId, accessDedupeKey(installationId, now), payload)
}

/**
 * A reconcile job for every attached board not reconciled within the
 * interval (§8.7). Cheap — one indexed read and one insert — so the
 * per-minute cron calls it every time.
 */
export async function enqueueDueReconciles(now = Date.now()): Promise<number> {
  const due = await prisma.gitHubProjectBinding.findMany({
    where: {
      detachedAt: null,
      OR: [{ lastReconciledAt: null }, { lastReconciledAt: { lt: new Date(now - RECONCILE_INTERVAL_MS) } }],
    },
    select: { projectId: true, installationId: true },
  })
  if (due.length === 0) return 0
  const { count } = await prisma.gitHubSyncJob.createMany({
    data: due.map(b => ({
      kind: 'reconcile',
      installationId: b.installationId,
      dedupeKey: reconcileDedupeKey(b.projectId, now),
      payload: { projectId: b.projectId } satisfies ReconcilePayload as Prisma.InputJsonValue,
    })),
    skipDuplicates: true,
  })
  return count
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
  /** Reconcile's client: the 'reconcile' priority, capped at 30% of the budget (§8.8). */
  reconcileClientFor?: (installationId: number) => GraphqlClient
  userClientFor?: (userId: string) => Promise<GraphqlClient | null>
  /** A writeback is the user's own write, on the user's token at write priority. */
  writeClientFor?: (userId: string) => Promise<GraphqlClient | null>
}

interface WritebackPayload {
  actorId: string
  projectId: string
  content: CreatedContent
  fields: Record<string, unknown>
}

/**
 * Finish a create that made its content but not its item or fields (P5b):
 * as the same user, never the installation (§8.6). Then the task is synced.
 */
async function runWriteback(payload: WritebackPayload, client: GraphqlClient | null): Promise<void> {
  if (!client) throw new Error('auth_required: the creating user has no usable GitHub token')
  const board = await boundBoard(payload.projectId)
  if (!board) return // unbound since: nothing left to finish

  let itemNodeId = payload.content.itemNodeId
  if (!itemNodeId) {
    const added = await client.query<{ m0: { item: { id: string } } }>(
      ADD_ITEM_DOCUMENT,
      { p: board.projectNodeId, c: payload.content.remoteNodeId },
      { strict: true },
    )
    itemNodeId = added.m0.item.id
  }
  const plan = planInitialFields(
    { ...payload.content, itemNodeId },
    { projectNodeId: board.projectNodeId, itemNodeId, binding: board.binding },
    payload.fields,
  )
  if (!('refused' in plan) && plan.document) await client.query(plan.document, plan.variables, { strict: true })

  const task = await prisma.task.findUnique({ where: { remoteNodeId: payload.content.remoteNodeId }, select: { id: true } })
  if (!task) return
  await prisma.$transaction([
    prisma.gitHubProjectItem.upsert({
      where: { itemNodeId },
      create: { itemNodeId, projectId: board.projectId, taskId: task.id },
      update: {},
    }),
    prisma.task.update({ where: { id: task.id }, data: { syncState: null } }),
  ])
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
  const reconcileClientFor = deps.reconcileClientFor ?? (id => installationGraphqlClient(id, 'reconcile'))
  const userClientFor = deps.userClientFor ?? (userId => userGraphqlClient(userId, 'hydrate'))
  const writeClientFor = deps.writeClientFor ?? (userId => userGraphqlClient(userId, 'write'))

  const run = async (job: ClaimedJob): Promise<void> => {
    switch (job.kind) {
      case 'hydrate':
        return runHydrate(job, clientFor(job.installationId))
      case 'reconcile': {
        const { projectId } = job.payload as unknown as ReconcilePayload
        await reconcileProject(projectId, reconcileClientFor(job.installationId))
        await syncBoardRoles(projectId, userClientFor)
        return
      }
      case 'access': {
        const boards = await prisma.gitHubProjectBinding.findMany({
          where: { installationId: (job.payload as unknown as AccessPayload).installationId, detachedAt: null },
          select: { projectId: true },
        })
        for (const { projectId } of boards) await syncBoardRoles(projectId, userClientFor)
        return
      }
      case 'writeback': {
        const payload = job.payload as unknown as WritebackPayload
        return runWriteback(payload, await writeClientFor(payload.actorId))
      }
      default:
        throw new Error(`Unknown sync job kind: ${job.kind}`)
    }
  }

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
        await run(job)
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
