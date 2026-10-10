/**
 * GitHub Projects boards: bind, import, unbind, and applying GitHub's state
 * to the replica (AWTD-1151, P4c).
 *
 * Spec: docs/specs/GITHUB_PROJECTS_WHITELABEL.md §8.4, §8.7, §11.2, §13.3.
 *
 * THE REPLICA WRITER. GitHub is authoritative for a bound board (§3.3): the
 * replica's task rows are written here, from hydrated GitHub state, not
 * through the TaskBackend seam — which refuses every Astrid-side edit to these
 * lists in P4 (lib/backends/github-project.ts). New tasks still go through
 * createTasksInBulk (fromRemote), so they get the events, reminders and cache
 * invalidation any created task gets.
 *
 * Per 100-item page: two reads (replicas by content node id, memberships by
 * item id), one bulk create, then one write per changed item — no N+1 reads
 * (§13.3).
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { DEFAULT_LIST_COLOR } from '@/lib/brand/colors'
import { RedisCache } from '@/lib/redis'
import { createLogger } from '@/lib/logger'
import { GITHUB_PROJECT_BACKEND } from '@/lib/backends/resolve'
import { normaliseItem, planItemApply, type BindingFieldMap, type RemoteProjectItem, type ReplicaTask } from '@/lib/github/projects/apply'
import { projectItemPages } from '@/lib/github/projects/hydrate'
import type { BindingProposal, ProjectSchema } from '@/lib/github/projects/bind'
import type { GraphqlClient } from '@/lib/github/rate-limiter'
import { createTasksInBulk } from '@/services/task-bulk-create'

const log = createLogger('services.github-projects')

/** A bound board, as the replica writer needs it. */
export interface BoundBoard {
  projectId: string
  listId: string
  ownerId: string
  binding: BindingFieldMap
}

export interface ApplySummary {
  created: number
  updated: number
  left: number
  unchanged: number
  skipped: number
}

const REPLICA_SELECT = {
  id: true,
  remoteNodeId: true,
  title: true,
  description: true,
  completed: true,
  closedReason: true,
  statusRole: true,
  priority: true,
  dueDateTime: true,
  isAllDay: true,
  identifier: true,
  remoteKind: true,
  remoteVersion: true,
} as const

/** completedAt follows completed: stamped when it turns on, cleared when off. */
function completionStamp(patch: { completed?: boolean }): { completedAt?: Date | null } {
  if (patch.completed === undefined) return {}
  return { completedAt: patch.completed ? new Date() : null }
}

/** Apply one hydrated page of a project's items to its board. */
export async function applyProjectItems(board: BoundBoard, items: RemoteProjectItem[]): Promise<ApplySummary> {
  const summary: ApplySummary = { created: 0, updated: 0, left: 0, unchanged: 0, skipped: 0 }
  const contentIds = items.flatMap(item => (item.content?.id && item.type !== 'REDACTED' ? [item.content.id] : []))

  const [replicaRows, memberships] = await Promise.all([
    prisma.task.findMany({ where: { remoteNodeId: { in: contentIds } }, select: REPLICA_SELECT }),
    prisma.gitHubProjectItem.findMany({
      where: { itemNodeId: { in: items.map(item => item.id) } },
      select: { itemNodeId: true, archived: true },
    }),
  ])
  const replicas = new Map(replicaRows.map(row => [row.remoteNodeId as string, row as unknown as ReplicaTask]))
  const memberOf = new Map(memberships.map(m => [m.itemNodeId, m]))

  const creates: Array<{ itemNodeId: string; data: NonNullable<ReturnType<typeof normaliseItem>> }> = []
  const writes: Prisma.PrismaPromise<unknown>[] = []

  for (const item of items) {
    const replica = item.content ? replicas.get(item.content.id) ?? null : null
    const plan = planItemApply({ item, binding: board.binding, replica, membership: memberOf.get(item.id) ?? null })

    switch (plan.action) {
      case 'skip':
        summary.skipped++
        break
      case 'noop':
        summary.unchanged++
        break
      case 'create':
        creates.push({ itemNodeId: item.id, data: plan.data })
        break
      case 'update': {
        const taskId = replica!.id
        writes.push(
          prisma.task.update({
            where: { id: taskId },
            data: {
              ...plan.patch,
              ...completionStamp(plan.patch),
              ...(plan.addMembership ? { lists: { connect: { id: board.listId } } } : {}),
            },
          }),
        )
        if (plan.addMembership) {
          writes.push(
            prisma.gitHubProjectItem.upsert({
              where: { itemNodeId: item.id },
              create: { itemNodeId: item.id, projectId: board.projectId, taskId },
              update: { archived: false },
            }),
          )
        }
        summary.updated++
        break
      }
      case 'leave':
        // Archived on GitHub: off this board, the task itself kept (§8.7).
        writes.push(
          prisma.gitHubProjectItem.update({ where: { itemNodeId: item.id }, data: { archived: true } }),
          prisma.task.update({ where: { id: replica!.id }, data: { lists: { disconnect: { id: board.listId } } } }),
        )
        summary.left++
        break
    }
  }

  if (writes.length > 0) await prisma.$transaction(writes)

  if (creates.length > 0) {
    const { tasks } = await createTasksInBulk({
      actorId: board.ownerId,
      fromRemote: { source: 'GitHub' },
      tasks: creates.map(({ data }) => ({
        listIds: [board.listId],
        identifier: data.identifier,
        data: {
          ...data.task,
          ...completionStamp(data.task),
          // A board's tasks are the board's, not one person's.
          isPrivate: false,
          remoteNodeId: data.remoteNodeId,
          remoteKind: data.remoteKind,
          remoteVersion: data.remoteVersion,
        },
      })),
    })
    const itemFor = new Map(creates.map(c => [c.data.remoteNodeId, c.itemNodeId]))
    await prisma.gitHubProjectItem.createMany({
      data: tasks.flatMap(task => {
        const itemNodeId = itemFor.get((task as unknown as { remoteNodeId: string }).remoteNodeId)
        return itemNodeId ? [{ itemNodeId, projectId: board.projectId, taskId: task.id }] : []
      }),
      skipDuplicates: true,
    })
    summary.created += tasks.length
  }

  // createTasksInBulk clears caches for what it created; updates and leaves
  // are ours to clear.
  if (writes.length > 0) {
    await RedisCache.invalidate.userTasks(board.ownerId, [board.listId]).catch(err => {
      log.warn({ err, projectId: board.projectId }, 'Failed to clear the board owner’s task cache')
    })
  }
  return summary
}

// ── Bind / import / unbind ──────────────────────────────────────────────────

export type BindResult =
  | { ok: true; projectId: string; listId: string }
  | { ok: false; status: 409; error: 'already_bound'; projectId: string }

/** Create the board — Project, its primary list, the binding — in one transaction. */
export async function bindGitHubProject(args: {
  userId: string
  installationId: number
  schema: ProjectSchema
  proposal: BindingProposal
}): Promise<BindResult> {
  const { userId, installationId, schema, proposal } = args

  const existing = await prisma.gitHubProjectBinding.findUnique({
    where: { projectNodeId: schema.id },
    select: { projectId: true },
  })
  if (existing) return { ok: false, status: 409, error: 'already_bound', projectId: existing.projectId }

  return prisma.$transaction(async tx => {
    const project = await tx.project.create({
      data: {
        name: schema.title,
        color: DEFAULT_LIST_COLOR,
        ownerId: userId,
        // No key: a GitHub board's tasks carry owner/repo#N (§8.1).
        githubInstallationId: installationId,
        customStates: proposal.customStates as unknown as Prisma.InputJsonValue,
        members: { create: { userId, role: 'admin' } },
      },
    })
    const list = await tx.taskList.create({
      data: {
        name: schema.title,
        color: DEFAULT_LIST_COLOR,
        ownerId: userId,
        projectId: project.id,
        backend: GITHUB_PROJECT_BACKEND,
      },
    })
    await tx.gitHubProjectBinding.create({
      data: {
        projectId: project.id,
        installationId,
        projectNodeId: schema.id,
        number: schema.number,
        statusFieldId: proposal.statusFieldId,
        statusOptionMap: proposal.statusOptionMap,
        priorityFieldId: proposal.priorityFieldId,
        priorityOptionMap: proposal.priorityOptionMap ?? Prisma.DbNull,
        dueFieldId: proposal.dueFieldId,
        estimateFieldId: proposal.estimateFieldId,
      },
    })
    return { ok: true as const, projectId: project.id, listId: list.id }
  })
}

/** The board for a bound project, or null if it is not bound. */
export async function boundBoard(projectId: string): Promise<(BoundBoard & { projectNodeId: string; installationId: number }) | null> {
  const binding = await prisma.gitHubProjectBinding.findUnique({
    where: { projectId },
    include: {
      project: {
        select: { ownerId: true, lists: { where: { backend: GITHUB_PROJECT_BACKEND }, select: { id: true }, take: 1 } },
      },
    },
  })
  const listId = binding?.project.lists[0]?.id
  if (!binding || !listId) return null
  return {
    projectId,
    listId,
    ownerId: binding.project.ownerId,
    projectNodeId: binding.projectNodeId,
    installationId: binding.installationId,
    binding: {
      statusFieldId: binding.statusFieldId,
      statusOptionMap: (binding.statusOptionMap ?? {}) as Record<string, string>,
      priorityFieldId: binding.priorityFieldId,
      priorityOptionMap: (binding.priorityOptionMap ?? null) as Record<string, number> | null,
      dueFieldId: binding.dueFieldId,
    },
  }
}

/** Page through every item and apply it (the initial import, §8.7). */
export async function importGitHubProject(projectId: string, client: GraphqlClient): Promise<ApplySummary> {
  const board = await boundBoard(projectId)
  if (!board) throw new Error(`Project ${projectId} is not bound to GitHub`)

  const total: ApplySummary = { created: 0, updated: 0, left: 0, unchanged: 0, skipped: 0 }
  for await (const items of projectItemPages(client, board.projectNodeId)) {
    const page = await applyProjectItems(board, items)
    for (const key of Object.keys(total) as Array<keyof ApplySummary>) total[key] += page[key]
  }
  await prisma.gitHubProjectBinding.update({ where: { projectId }, data: { lastReconciledAt: new Date() } })
  log.info({ projectId, ...total }, 'GitHub project imported')
  return total
}

/** The mapping fields a person may change after binding (§11.2 PATCH). */
export interface BindingPatch {
  statusOptionMap?: Record<string, string>
  priorityFieldId?: string | null
  priorityOptionMap?: Record<string, number> | null
  dueFieldId?: string | null
}

export async function updateBindingMapping(projectId: string, patch: BindingPatch) {
  return prisma.gitHubProjectBinding.update({
    where: { projectId },
    data: {
      ...(patch.statusOptionMap !== undefined ? { statusOptionMap: patch.statusOptionMap } : {}),
      ...(patch.priorityFieldId !== undefined ? { priorityFieldId: patch.priorityFieldId } : {}),
      ...(patch.priorityOptionMap !== undefined ? { priorityOptionMap: patch.priorityOptionMap ?? Prisma.DbNull } : {}),
      ...(patch.dueFieldId !== undefined ? { dueFieldId: patch.dueFieldId } : {}),
    },
  })
}

/**
 * Unbind: the board stays as an ordinary Astrid board — a local snapshot of
 * what it mirrored (§11.2 DELETE). The tasks keep their remote identity so a
 * re-bind finds them rather than duplicating them.
 */
export async function unbindGitHubProject(projectId: string): Promise<void> {
  await prisma.$transaction([
    prisma.gitHubProjectBinding.delete({ where: { projectId } }),
    prisma.taskList.updateMany({ where: { projectId, backend: GITHUB_PROJECT_BACKEND }, data: { backend: null } }),
    prisma.project.update({ where: { id: projectId }, data: { githubInstallationId: null } }),
  ])
}

// ── Reads for the binding routes ───────────────────────────────────────────

const BINDING_SELECT = {
  projectId: true,
  installationId: true,
  projectNodeId: true,
  number: true,
  statusFieldId: true,
  statusOptionMap: true,
  priorityFieldId: true,
  priorityOptionMap: true,
  dueFieldId: true,
  estimateFieldId: true,
  lastReconciledAt: true,
} as const

/** The board each of these GitHub projects is bound to, if any. */
export async function boardsForProjectNodes(projectNodeIds: string[]): Promise<Map<string, string>> {
  if (projectNodeIds.length === 0) return new Map()
  const rows = await prisma.gitHubProjectBinding.findMany({
    where: { projectNodeId: { in: projectNodeIds } },
    select: { projectNodeId: true, projectId: true },
  })
  return new Map(rows.map(row => [row.projectNodeId, row.projectId]))
}

/** A board's binding as the API shows it; null when the board is not bound. */
export function readBinding(projectId: string) {
  return prisma.gitHubProjectBinding.findUnique({ where: { projectId }, select: BINDING_SELECT })
}
