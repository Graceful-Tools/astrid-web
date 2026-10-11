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
import { BRAND } from '@/lib/brand/config'
import { runAfterResponse } from '@/lib/background'
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
import { itemMoves, planItemMoves } from '@/lib/github/projects/position'
import {
  createdAgentLabelIds,
  parseAgentLabelLookup,
  planAgentLabelChange,
  planAgentLabelCreate,
  planAgentLabelLookup,
  planAgentLabelWrite,
  type AgentLabelPayload,
} from '@/lib/github/projects/agent-labels'

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
  /** An agent's comment, and its `agent:<name>` label, go out as the App bot (§8.6). */
  agentClientFor?: (installationId: number) => GraphqlClient
}

interface PositionPayload {
  listId: string
  actorId: string
  previous: string[]
  next: string[]
}

/** Queue a GitHub board's reorder (AWTD-1116 P5c); nothing if nothing moved. */
export async function enqueuePositionSync(payload: PositionPayload): Promise<boolean> {
  if (itemMoves(payload.previous, payload.next).length === 0) return false
  const list = await prisma.taskList.findUnique({
    where: { id: payload.listId },
    select: { project: { select: { githubBinding: { select: { installationId: true } } } } },
  })
  const installationId = list?.project?.githubBinding?.installationId
  if (!installationId) return false
  // Unique per reorder: each is its own user action, applied in order.
  const queued = await enqueue('position', installationId, `position:${payload.listId}:${Date.now()}`, payload)
  runAfterResponse('github-projects-drain', () => drainSyncJobs())
  return queued
}

async function runPositionSync(payload: PositionPayload, client: GraphqlClient | null): Promise<void> {
  if (!client) throw new Error('auth_required: the user who reordered has no usable GitHub token')
  const list = await prisma.taskList.findUnique({
    where: { id: payload.listId },
    select: { project: { select: { githubBinding: { select: { projectId: true, projectNodeId: true } } } } },
  })
  const binding = list?.project?.githubBinding
  if (!binding) return
  const items = await prisma.gitHubProjectItem.findMany({
    where: { projectId: binding.projectId, archived: false, taskId: { in: payload.next } },
    select: { taskId: true, itemNodeId: true },
  })
  const itemFor = new Map(items.map(i => [i.taskId, i.itemNodeId]))
  const plan = planItemMoves(binding.projectNodeId, itemMoves(payload.previous, payload.next), id => itemFor.get(id))
  if (plan) await client.query(plan.document, plan.variables, { strict: true })
}

interface CommentPayload {
  commentId: string
}

/**
 * Queue a new Astrid comment for its GitHub issue or PR (AWTD-1116 P5c). Not
 * for drafts (GitHub gives them no comments), system comments (no author), or
 * tasks on no GitHub board. One indexed read when it applies.
 */
export async function enqueueCommentPush(commentId: string, taskId: string): Promise<boolean> {
  const item = await prisma.gitHubProjectItem.findFirst({
    where: { taskId, archived: false, task: { remoteKind: { in: ['issue', 'pull_request'] } } },
    select: { binding: { select: { installationId: true } } },
  })
  if (!item) return false
  const queued = await enqueue('comment', item.binding.installationId, `comment:${commentId}`, { commentId })
  runAfterResponse('github-projects-drain', () => drainSyncJobs())
  return queued
}

/**
 * Post an Astrid comment to GitHub: a person's as themselves (their token);
 * an agent's as the App bot, prefixed "**<Agent>** (via <Brand>)" (§8.6).
 */
async function runCommentPush(
  payload: CommentPayload,
  installationId: number,
  clients: { user: (id: string) => Promise<GraphqlClient | null>; installation: (id: number) => GraphqlClient },
): Promise<void> {
  const comment = await prisma.comment.findUnique({
    where: { id: payload.commentId },
    select: {
      content: true,
      authorId: true,
      type: true,
      author: { select: { name: true, isAIAgent: true } },
      task: { select: { remoteNodeId: true } },
    },
  })
  // Deleted since, a system line, or not mirrored: nothing to post.
  if (!comment?.authorId || !comment.task.remoteNodeId || comment.type !== 'TEXT' || !comment.content.trim()) return

  const asAgent = Boolean(comment.author?.isAIAgent)
  const client = asAgent ? clients.installation(installationId) : await clients.user(comment.authorId)
  if (!client) throw new Error('auth_required: the comment author has no usable GitHub token')
  const body = asAgent ? `**${comment.author?.name ?? 'Agent'}** (via ${BRAND.appName})\n\n${comment.content}` : comment.content

  await client.query(
    'mutation($s: ID!, $b: String!) { m0: addComment(input: { subjectId: $s, body: $b }) { commentEdge { node { id } } } }',
    { s: comment.task.remoteNodeId, b: body },
    { strict: true },
  )
}

/**
 * Make an issue's `agent:<name>` labels match the agents assigned in Astrid
 * (AWTD-1191 P6c-5), creating a label the repo lacks. As the App bot: an
 * agent is not a GitHub user, and the label reports Astrid's assignment
 * rather than making a person's edit (§8.6). Safe to run twice.
 */
async function runAgentLabelSync(payload: AgentLabelPayload, client: GraphqlClient): Promise<void> {
  const lookup = planAgentLabelLookup(payload.remoteNodeId, payload.labels)
  const state = parseAgentLabelLookup(await client.query(lookup.document, lookup.variables), payload.labels)
  if (!state) return // deleted on GitHub, or no longer visible to the App

  const change = planAgentLabelChange(state, payload.labels)
  let created: string[] = []
  if (change.create.length > 0) {
    const create = planAgentLabelCreate(state.repositoryId, change.create, `Assigned to an AI agent in ${BRAND.appName}`)
    created = createdAgentLabelIds(await client.query(create.document, create.variables, { strict: true }), change.create.length)
  }
  const write = planAgentLabelWrite(payload.remoteNodeId, [...change.add, ...created], change.remove)
  if (write) await client.query(write.document, write.variables, { strict: true })
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
      case 'position': {
        const payload = job.payload as unknown as PositionPayload
        return runPositionSync(payload, await writeClientFor(payload.actorId))
      }
      case 'comment':
        return runCommentPush(job.payload as unknown as CommentPayload, job.installationId, {
          user: writeClientFor,
          installation: deps.agentClientFor ?? (id => installationGraphqlClient(id, 'write')),
        })
      case 'agent_label':
        return runAgentLabelSync(
          job.payload as unknown as AgentLabelPayload,
          (deps.agentClientFor ?? (id => installationGraphqlClient(id, 'write')))(job.installationId),
        )
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
