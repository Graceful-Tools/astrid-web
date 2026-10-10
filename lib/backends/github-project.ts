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
 * GitHub's own news (ctx.origin 'remote') is accepted as is. Create and delete
 * are still refused here: P5b and P5c.
 */

import { prisma } from '@/lib/prisma'
import type { BindingFieldMap } from '@/lib/github/projects/apply'
import {
  planRemoteUpdate,
  versionFromResult,
  type WritableMembership,
  type WritableTask,
} from '@/lib/github/projects/write'
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

export function createGithubProjectTaskBackend(deps: GithubBackendDeps): TaskBackend {
  return {
    kind: 'github_project',
    createTask: async (ctx, data) => (ctx.origin === 'remote' ? { ok: true, value: data } : refusal),
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
