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
 *
 * An agent's assignment is not the user's edit to GitHub: when the brand
 * mirrors it (AWTD-1191), the `agent:<name>` label is queued for the App bot
 * and the write never waits on it.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { hasCapability } from '@/lib/brand/capabilities'
import { agentLabelName, type AgentLabelPayload } from '@/lib/github/projects/agent-labels'
import type { BindingFieldMap } from '@/lib/github/projects/apply'
import { assigneeIdsOf, nextAssigneeIds } from '@/lib/task-assignees'
import {
  planRemoveFromProjects,
  planRemoteUpdate,
  versionFromResult,
  type AssigneeChange,
  type MembershipChanges,
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
  /** Does this brand mirror agent assignment as a label? Defaults to the capability. */
  agentLabels?: () => boolean
}

type BoardMembership = WritableMembership & { listId: string | null; projectId: string }

async function loadWritable(
  taskId: string,
): Promise<{
  task: WritableTask
  memberships: BoardMembership[]
  detached: boolean
  installationId: number | null
  /** Everyone assigned today, primary first (AWTD-1190). */
  assigneeIds: string[]
} | null> {
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
      assigneeId: true,
      assigneeIds: true,
      githubProjectItems: {
        where: { archived: false },
        select: {
          itemNodeId: true,
          binding: {
            select: {
              projectId: true,
              projectNodeId: true,
              installationId: true,
              detachedAt: true,
              project: { select: { lists: { where: { backend: 'github_project' }, select: { id: true }, take: 1 } } },
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
    assigneeIds: assigneeIdsOf(row),
    task: { ...row, remoteNodeId: row.remoteNodeId, remoteKind: row.remoteKind as WritableTask['remoteKind'] },
    detached: row.githubProjectItems.some(m => m.binding.detachedAt !== null),
    installationId: row.githubProjectItems[0]?.binding.installationId ?? null,
    memberships: row.githubProjectItems.map(m => ({
      projectId: m.binding.projectId,
      listId: m.binding.project.lists[0]?.id ?? null,
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

/**
 * What `lists: { set }` does to the task's GitHub boards: boards it leaves
 * lose the item; GitHub lists it joins gain one. Other list changes
 * (connect/disconnect of personal or status lists) are Astrid-only.
 */
async function membershipChanges(
  data: TaskBackendRow,
  memberships: BoardMembership[],
): Promise<MembershipChanges & { addedProjects: Record<string, string> }> {
  const set = (data.lists as { set?: Array<{ id: string }> } | undefined)?.set
  if (!set) return { remove: [], add: [], addedProjects: {} }
  const next = new Set(set.map(l => l.id))
  const remove = memberships.filter(m => m.listId && !next.has(m.listId))
  const held = new Set(memberships.map(m => m.listId))
  const joining = [...next].filter(id => !held.has(id))
  if (joining.length === 0) return { remove, add: [], addedProjects: {} }

  const boards = await prisma.taskList.findMany({
    where: { id: { in: joining }, backend: 'github_project' },
    select: { project: { select: { githubBinding: { select: { projectNodeId: true, projectId: true } } } } },
  })
  const addedProjects: Record<string, string> = {}
  for (const b of boards) {
    const binding = b.project?.githubBinding
    if (binding) addedProjects[binding.projectNodeId] = binding.projectId
  }
  return { remove, add: Object.keys(addedProjects), addedProjects }
}

/** The GitHubProjectItem rows to match: removed items go, added ones arrive. */
function membershipRows(
  result: Record<string, unknown>,
  plan: { addedItems: Record<string, string>; removedItems: string[] },
  addedProjects: Record<string, string>,
) {
  const create = Object.entries(plan.addedItems).flatMap(([alias, projectNodeId]) => {
    const id = (result[alias] as { item?: { id?: string } } | undefined)?.item?.id
    return id ? [{ itemNodeId: id, projectId: addedProjects[projectNodeId] }] : []
  })
  if (create.length === 0 && plan.removedItems.length === 0) return {}
  return {
    githubProjectItems: {
      ...(plan.removedItems.length ? { deleteMany: { itemNodeId: { in: plan.removedItems } } } : {}),
      ...(create.length ? { create } : {}),
    },
  }
}

/**
 * The assignee change as GitHub node ids — exactly who was added and who was
 * removed (AWTD-1190) — or a refusal. An agent is never a GitHub assignee
 * (§8.6): assigning one adds nobody there. A person who has not authorised
 * the App has no node id yet, so cannot be added.
 *
 * `agentLabels` is set when an agent came or went: the label of every agent
 * assigned after the write (AWTD-1191).
 */
async function assigneeChange(
  data: TaskBackendRow,
  current: string[],
): Promise<{ change?: AssigneeChange; agentLabels?: string[]; refused?: string }> {
  if (!('assigneeId' in data) && !('assigneeIds' in data)) return {}
  // The service writes both. A caller that writes assigneeId alone replaces the first entry.
  const written = Array.isArray(data.assigneeIds)
    ? ({ ok: true, assigneeIds: data.assigneeIds as string[] } as const)
    : nextAssigneeIds({ current, intent: { assigneeId: data.assigneeId as string | null }, multiple: true })
  const next = written.ok ? written.assigneeIds : current
  const added = next.filter(id => !current.includes(id))
  const removed = current.filter(id => !next.includes(id))
  if (added.length === 0 && removed.length === 0) return {}

  const users = await prisma.user.findMany({
    where: { id: { in: [...next, ...removed] } },
    select: { id: true, githubNodeId: true, isAIAgent: true, email: true, name: true },
  })
  const agents = new Map(users.filter(user => user.isAIAgent).map(user => [user.id, agentLabelName(user)]))
  const nodeIdOf = new Map(
    users.filter(user => !user.isAIAgent && user.githubNodeId).map(user => [user.id, user.githubNodeId as string]),
  )
  if (added.some(id => !agents.has(id) && !nodeIdOf.has(id))) return { refused: 'github_assignee_not_linked' }
  const nodeIds = (ids: string[]) => ids.flatMap(id => (nodeIdOf.has(id) ? [nodeIdOf.get(id) as string] : []))
  const agentLabels = [...added, ...removed].some(id => agents.has(id))
    ? next.flatMap(id => agents.get(id) ?? [])
    : undefined
  return { change: { add: nodeIds(added), remove: nodeIds(removed), set: nodeIds(next) }, agentLabels }
}

const agentLabelKey = (remoteNodeId: string) => `agent-label:${remoteNodeId}`

/**
 * Queue the labels an issue should carry for its agents. One job per issue,
 * holding the latest answer: a second change before the first has run
 * replaces it, so two can never land out of order.
 */
async function queueAgentLabels(installationId: number, remoteNodeId: string, labels: string[]): Promise<void> {
  const payload = { remoteNodeId, labels } satisfies AgentLabelPayload
  const pending = { payload, installationId, attempts: 0, runAfter: new Date(), doneAt: null, error: null }
  await prisma.gitHubSyncJob.upsert({
    where: { dedupeKey: agentLabelKey(remoteNodeId) },
    create: { kind: 'agent_label', dedupeKey: agentLabelKey(remoteNodeId), ...pending },
    update: pending,
  })
}

/** The labels of the agents among a new task's assignees. */
async function agentLabelsOf(data: TaskBackendRow): Promise<string[]> {
  const ids = Array.isArray(data.assigneeIds) ? (data.assigneeIds as string[]) : data.assigneeId ? [data.assigneeId as string] : []
  if (ids.length === 0) return []
  const agents = await prisma.user.findMany({ where: { id: { in: ids }, isAIAgent: true }, select: { email: true, name: true } })
  return agents.flatMap(agent => agentLabelName(agent) ?? [])
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
  const mirrorsAgents = deps.agentLabels ?? (() => hasCapability('githubAgentLabels'))

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

      // A draft has no labels: its agent assignment stays in the replica.
      if (content.remoteKind !== 'draft' && mirrorsAgents()) {
        const labels = await agentLabelsOf(data)
        if (labels.length > 0) await queueAgentLabels(binding.installationId, content.remoteNodeId, labels)
      }

      return { ok: true, value: acceptCreated(data, content, binding.projectId, syncState) }
    },

    /**
     * An Astrid delete on a GitHub board REMOVES the item from its projects
     * (§8.7); the issue stays on GitHub. Deleting the issue itself is not
     * offered here — it needs explicit confirmation and repo admin rights.
     */
    async deleteTask(ctx, taskId): Promise<TaskBackendResult<void>> {
      if (ctx.origin === 'remote') return { ok: true, value: undefined }
      const loaded = await loadWritable(taskId)
      if (!loaded || loaded.memberships.length === 0) return { ok: true, value: undefined }
      if (loaded.detached) return refusal

      const client = await deps.userClient(ctx.actorId)
      if (!client) return fail(403, 'auth_required')
      try {
        const plan = planRemoveFromProjects(loaded.memberships)
        await client.query(plan.document, plan.variables, { strict: true })
        return { ok: true, value: undefined }
      } catch (err) {
        return refusalFor(err)
      }
    },

    async updateTask(ctx, taskId, data): Promise<TaskBackendResult<TaskBackendRow>> {
      if (ctx.origin === 'remote') return { ok: true, value: data }

      const loaded = await loadWritable(taskId)
      // Not a mirrored task (P5b creates them), or its installation is gone.
      if (!loaded || loaded.detached) return refusal

      const changes = await membershipChanges(data, loaded.memberships)
      const assignee = await assigneeChange(data, loaded.assigneeIds)
      if (assignee.refused) return fail(400, assignee.refused)
      const plan = planRemoteUpdate(loaded.task, loaded.memberships, data, changes, assignee.change)
      if ('refused' in plan) return fail(400, `github_${plan.refused}`)

      // A draft has no labels: its agent assignment stays in the replica.
      const mirrorAgents = async () => {
        if (!assignee.agentLabels || loaded.task.remoteKind === 'draft' || loaded.installationId === null) return
        if (mirrorsAgents()) await queueAgentLabels(loaded.installationId, loaded.task.remoteNodeId, assignee.agentLabels)
      }
      if (!plan.document) {
        await mirrorAgents()
        return { ok: true, value: data } // nothing GitHub owns changed
      }

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
        await mirrorAgents()
        return {
          ok: true,
          value: {
            ...data,
            ...(remoteVersion ? { remoteVersion } : {}),
            ...membershipRows(result, plan, changes.addedProjects),
          },
        }
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
