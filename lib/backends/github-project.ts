/**
 * The backend for tasks on a list bound to a GitHub Project.
 *
 * P4 (AWTD-1151) made it read-only. P5a (AWTD-1116) writes edits THROUGH to
 * GitHub, as the person making them (spec §8.6): their App user token,
 * never the installation's — GitHub then attributes the edit and enforces
 * their permissions, so Astrid does not re-implement GitHub's. A user with no
 * usable token gets `auth_required` and nothing is written anywhere.
 *
 *   load      the task as the replica holds it, and its project memberships
 *   plan      lib/github/projects/write.ts — one aliased mutation document
 *   check     a body edit on a stale remoteVersion is a 409 conflict (§8.7)
 *   send      strict: any GraphQL error fails the whole write
 *   accept    the row data, with the remoteVersion GitHub reported
 *
 * Create (P5b) makes the content as the user — an issue in the board's
 * default repo, or a draft — adds it to the project and sets its fields
 * (lib/github/projects/create.ts). With a clientRequestId, an outbox row is
 * written FIRST: a replay after GitHub answered returns that same issue, and
 * a replay while one is in flight is told so (409), never a second issue.
 * Content made but fields not set is kept as syncState 'pending' with a
 * writeback job to finish it.
 *
 * GitHub's own news (ctx.origin 'remote') is accepted as is. Delete is still
 * refused here: P5c.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { BindingFieldMap } from '@/lib/github/projects/apply'
import {
  planRemoteUpdate,
  versionFromResult,
  type WritableMembership,
  type WritableTask,
} from '@/lib/github/projects/write'
import {
  ADD_ITEM_DOCUMENT,
  parseCreatedContent,
  planCreateContent,
  planInitialFields,
  type CreatedContent,
} from '@/lib/github/projects/create'
import type { GraphqlClient } from '@/lib/github/rate-limiter'
import type { TaskBackend, TaskBackendResult, TaskBackendRow } from './types'

/** The refusal's error code. Stable: clients match on it. */
export const GITHUB_PROJECT_READ_ONLY = 'github_project_read_only'

const refusal = { ok: false as const, status: 403 as const, error: GITHUB_PROJECT_READ_ONLY }
const fail = (status: 400 | 403 | 409 | 429 | 502, error: string, extra: object = {}) =>
  ({ ok: false as const, status, error, ...extra })

const CONTENT_VERSION_QUERY = /* GraphQL */ `
query ContentVersion($id: ID!) {
  node(id: $id) {
    ... on Issue { updatedAt }
    ... on PullRequest { updatedAt }
    ... on DraftIssue { updatedAt }
  }
  rateLimit { cost remaining resetAt }
}`

export interface GithubBackendDeps {
  /** The acting user's client; null when they have no usable App token. */
  userClient: (userId: string) => Promise<GraphqlClient | null>
}

async function loadWritable(
  taskId: string,
): Promise<{ task: WritableTask; memberships: WritableMembership[]; detached: boolean } | null> {
  const row = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      remoteNodeId: true,
      remoteKind: true,
      remoteVersion: true,
      title: true,
      description: true,
      completed: true,
      closedReason: true,
      statusRole: true,
      priority: true,
      dueDateTime: true,
      githubProjectItems: {
        where: { archived: false },
        select: {
          itemNodeId: true,
          binding: {
            select: {
              projectNodeId: true,
              detachedAt: true,
              statusFieldId: true,
              statusOptionMap: true,
              priorityFieldId: true,
              priorityOptionMap: true,
              dueFieldId: true,
            },
          },
        },
      },
    },
  })
  if (!row?.remoteNodeId || !row.remoteKind) return null
  return {
    task: { ...row, remoteNodeId: row.remoteNodeId, remoteKind: row.remoteKind as WritableTask['remoteKind'] },
    detached: row.githubProjectItems.some(m => m.binding.detachedAt !== null),
    memberships: row.githubProjectItems.map(m => ({
      projectNodeId: m.binding.projectNodeId,
      itemNodeId: m.itemNodeId,
      binding: {
        statusFieldId: m.binding.statusFieldId,
        statusOptionMap: (m.binding.statusOptionMap ?? {}) as Record<string, string>,
        priorityFieldId: m.binding.priorityFieldId,
        priorityOptionMap: (m.binding.priorityOptionMap ?? null) as Record<string, number> | null,
        dueFieldId: m.binding.dueFieldId,
      } satisfies BindingFieldMap,
    })),
  }
}

/** A GitHub failure as a backend refusal, in the v1 vocabulary (§11.2). */
function refusalFor(err: unknown): TaskBackendResult<never> {
  const e = err as Error & { status?: number; retryAfterMs?: number; ssoUrl?: string }
  if (e?.name === 'GitHubRateLimitedError') {
    return fail(429, 'rate_limited', { retryAfter: Math.ceil((e.retryAfterMs ?? 60_000) / 1000) })
  }
  if (e?.name === 'GitHubGraphqlError') {
    if (e.ssoUrl) return fail(403, 'sso_required', { ssoUrl: e.ssoUrl })
    if (e.status === 401) return fail(403, 'auth_required')
    if (e.status === 403 || e.status === 404) return fail(403, 'forbidden')
    if (e.status === 422) return fail(400, 'github_rejected')
    return fail(502, 'upstream_unavailable')
  }
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return fail(502, 'upstream_unavailable')
  throw err
}

// ── Create ──────────────────────────────────────────────────────────────────

/** How long a create in flight holds its clientRequestId before a replay may take over. */
const CREATE_LOCK_MS = 2 * 60_000

type CreateClaim = { kind: 'new' } | { kind: 'done'; remote: CreatedContent } | { kind: 'busy' }

const createKey = (clientRequestId: string) => `create:${clientRequestId}`

/**
 * The outbox row, written BEFORE GitHub is called. Stored as an already-done
 * GitHubSyncJob so no drainer runs it; its payload gains `remote` once GitHub
 * has answered.
 */
async function claimCreate(clientRequestId: string, installationId: number): Promise<CreateClaim> {
  const now = Date.now()
  try {
    await prisma.gitHubSyncJob.create({
      data: {
        kind: 'create',
        dedupeKey: createKey(clientRequestId),
        installationId,
        payload: {},
        doneAt: new Date(now),
        lockedUntil: new Date(now + CREATE_LOCK_MS),
      },
    })
    return { kind: 'new' }
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err
  }
  const row = await prisma.gitHubSyncJob.findUnique({ where: { dedupeKey: createKey(clientRequestId) } })
  const remote = (row?.payload as { remote?: CreatedContent } | null)?.remote
  if (remote) return { kind: 'done', remote }
  // An abandoned attempt (its lock expired) may be retried; a live one may not.
  const { count } = await prisma.gitHubSyncJob.updateMany({
    where: { dedupeKey: createKey(clientRequestId), lockedUntil: { lt: new Date(now) } },
    data: { lockedUntil: new Date(now + CREATE_LOCK_MS) },
  })
  return count === 1 ? { kind: 'new' } : { kind: 'busy' }
}

const recordCreated = (clientRequestId: string, remote: CreatedContent) =>
  prisma.gitHubSyncJob.update({
    where: { dedupeKey: createKey(clientRequestId) },
    data: { payload: { remote } as unknown as Prisma.InputJsonValue, lockedUntil: null },
  })

const releaseCreate = (clientRequestId: string) =>
  prisma.gitHubSyncJob.deleteMany({ where: { dedupeKey: createKey(clientRequestId) } })

/** The fields step 3 sets — kept on a writeback job if it fails. */
const FIELD_KEYS = ['statusRole', 'priority', 'dueDateTime', 'completed', 'closedReason'] as const

async function loadBoardForCreate(data: TaskBackendRow) {
  const connect = (data.lists as { connect?: Array<{ id: string }> } | undefined)?.connect ?? []
  const list = await prisma.taskList.findFirst({
    where: { id: { in: connect.map(l => l.id) }, backend: 'github_project' },
    select: {
      project: {
        select: {
          githubBinding: {
            select: {
              projectId: true,
              projectNodeId: true,
              installationId: true,
              detachedAt: true,
              defaultRepoNodeId: true,
              statusFieldId: true,
              statusOptionMap: true,
              priorityFieldId: true,
              priorityOptionMap: true,
              dueFieldId: true,
            },
          },
        },
      },
    },
  })
  return list?.project?.githubBinding ?? null
}

/** The row to insert: Astrid's data plus GitHub's identity for it. */
function acceptCreated(data: TaskBackendRow, content: CreatedContent, projectId: string, syncState: string | null) {
  return {
    ...data,
    remoteNodeId: content.remoteNodeId,
    remoteKind: content.remoteKind,
    remoteVersion: content.remoteVersion,
    // GitHub's owner/repo#N; a draft has none until converted (§9.3).
    identifier: content.identifier,
    sequence: null,
    isPrivate: false,
    syncState,
    ...(content.itemNodeId
      ? { githubProjectItems: { create: [{ itemNodeId: content.itemNodeId, projectId }] } }
      : {}),
  }
}

export function createGithubProjectTaskBackend(deps: GithubBackendDeps): TaskBackend {
  return {
    kind: 'github_project',

    async createTask(ctx, data): Promise<TaskBackendResult<TaskBackendRow>> {
      if (ctx.origin === 'remote') return { ok: true, value: data }

      const binding = await loadBoardForCreate(data)
      if (!binding || binding.detachedAt) return refusal

      const membershipFor = (itemNodeId: string): WritableMembership => ({
        projectNodeId: binding.projectNodeId,
        itemNodeId,
        binding: {
          statusFieldId: binding.statusFieldId,
          statusOptionMap: (binding.statusOptionMap ?? {}) as Record<string, string>,
          priorityFieldId: binding.priorityFieldId,
          priorityOptionMap: (binding.priorityOptionMap ?? null) as Record<string, number> | null,
          dueFieldId: binding.dueFieldId,
        },
      })
      // Refuse an impossible lane or field BEFORE anything exists on GitHub.
      const kind = binding.defaultRepoNodeId ? 'issue' : 'draft'
      const preview = planInitialFields(
        { remoteNodeId: 'pending', remoteKind: kind, remoteVersion: '', identifier: null, itemNodeId: 'pending' },
        membershipFor('pending'),
        data,
      )
      if ('refused' in preview) return fail(400, `github_${preview.refused}`)

      const client = await deps.userClient(ctx.actorId)
      if (!client) return fail(403, 'auth_required')

      const clientRequestId = typeof data.clientRequestId === 'string' ? data.clientRequestId : null
      if (clientRequestId) {
        const claim = await claimCreate(clientRequestId, binding.installationId)
        if (claim.kind === 'busy') return fail(409, 'create_in_progress')
        if (claim.kind === 'done') return { ok: true, value: acceptCreated(data, claim.remote, binding.projectId, null) }
      }

      // 1. The content. A failure here leaves nothing on GitHub: release the claim.
      let content: CreatedContent
      try {
        const plan = planCreateContent(binding, data as { title: string; description?: string | null })
        content = parseCreatedContent(await client.query(plan.document, plan.variables, { strict: true }))
      } catch (err) {
        if (clientRequestId) await releaseCreate(clientRequestId)
        return refusalFor(err)
      }
      if (clientRequestId) await recordCreated(clientRequestId, content)

      // 2 + 3. The item and its fields. The content exists now, so a failure
      // here is partial: keep the task, and let a writeback job finish it.
      let syncState: string | null = null
      try {
        if (!content.itemNodeId) {
          const added = await client.query<{ m0: { item: { id: string } } }>(
            ADD_ITEM_DOCUMENT,
            { p: binding.projectNodeId, c: content.remoteNodeId },
            { strict: true },
          )
          content = { ...content, itemNodeId: added.m0.item.id }
          if (clientRequestId) await recordCreated(clientRequestId, content)
        }
        const fields = planInitialFields(content, membershipFor(content.itemNodeId!), data)
        if (!('refused' in fields) && fields.document) {
          await client.query(fields.document, fields.variables, { strict: true })
        }
      } catch {
        syncState = 'pending'
        await prisma.gitHubSyncJob.createMany({
          data: [
            {
              kind: 'writeback',
              installationId: binding.installationId,
              dedupeKey: `writeback:${content.remoteNodeId}`,
              payload: {
                actorId: ctx.actorId,
                projectId: binding.projectId,
                content,
                fields: Object.fromEntries(FIELD_KEYS.filter(k => k in data).map(k => [k, data[k]])),
              } as unknown as Prisma.InputJsonValue,
            },
          ],
          skipDuplicates: true,
        })
      }

      return { ok: true, value: acceptCreated(data, content, binding.projectId, syncState) }
    },

    deleteTask: async ctx => (ctx.origin === 'remote' ? { ok: true, value: undefined } : refusal),

    async updateTask(ctx, taskId, data): Promise<TaskBackendResult<TaskBackendRow>> {
      if (ctx.origin === 'remote') return { ok: true, value: data }

      const loaded = await loadWritable(taskId)
      // Not a mirrored task (P5b creates them), or its installation is gone.
      if (!loaded || loaded.detached) return refusal

      const plan = planRemoteUpdate(loaded.task, loaded.memberships, data)
      if ('refused' in plan) return fail(400, `github_${plan.refused}`)
      if (!plan.document) return { ok: true, value: data } // nothing GitHub owns changed

      const client = await deps.userClient(ctx.actorId)
      if (!client) return fail(403, 'auth_required')

      try {
        if (plan.editsBody && loaded.task.remoteVersion) {
          const now = await client.query<{ node: { updatedAt?: string } | null }>(CONTENT_VERSION_QUERY, {
            id: loaded.task.remoteNodeId,
          })
          if (now.node?.updatedAt && now.node.updatedAt !== loaded.task.remoteVersion) {
            return fail(409, 'conflict')
          }
        }
        const result = await client.query<Record<string, unknown>>(plan.document, plan.variables, { strict: true })
        const remoteVersion = versionFromResult(result, plan.versionAliases)
        return { ok: true, value: remoteVersion ? { ...data, remoteVersion } : data }
      } catch (err) {
        return refusalFor(err)
      }
    },
  }
}

/** The backend with real user clients, loaded lazily to keep Octokit out of the seam's import graph. */
export const githubProjectTaskBackend: TaskBackend = createGithubProjectTaskBackend({
  userClient: async userId => (await import('@/lib/github/graphql-clients')).userGraphqlClient(userId, 'write'),
})
