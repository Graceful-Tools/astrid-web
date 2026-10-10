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
import { planRelations, remoteRelations } from '@/lib/github/projects/relations'
import {
  isEmptyLabelPlan,
  labelListColor,
  labelListDrift,
  planLabels,
  remoteLabels,
  type RemoteLabel,
} from '@/lib/github/projects/labels'
import { GITHUB_LABEL_LIST } from '@/lib/backends/github-labels'
import { LIST_TYPE_LABEL } from '@/lib/list-flavors'
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
  // Relationships (AWTD-1119). Only MIRRORED blockers are read back: a blocker
  // on a local Astrid task is never GitHub's to remove.
  parentTaskId: true,
  parentTask: { select: { remoteNodeId: true } },
  blockedBy: { where: { blockingTask: { remoteNodeId: { not: null } } }, select: { blockingTaskId: true } },
  // Labels (AWTD-1188). Only lists that mirror a GITHUB label are read back:
  // a label a person gave the task in Astrid is never GitHub's to remove.
  lists: { where: GITHUB_LABEL_LIST, select: { id: true, remoteNodeId: true } },
} as const

type ReplicaRow = Prisma.TaskGetPayload<{ select: typeof REPLICA_SELECT }>

/** completedAt follows completed: stamped when it turns on, cleared when off. */
function completionStamp(patch: { completed?: boolean }): { completedAt?: Date | null } {
  if (patch.completed === undefined) return {}
  return { completedAt: patch.completed ? new Date() : null }
}

/**
 * Sub-issues and dependencies for one page (AWTD-1119), after its tasks exist
 * so that a child imported beside its parent can point at it. An end that is
 * not on this page costs one read for the whole page; an end no board mirrors
 * is not a relationship here. A child paged in before its parent is healed the
 * next time it is hydrated or reconciled.
 */
async function applyRelations(
  items: RemoteProjectItem[],
  replicas: Map<string, ReplicaRow>,
  created: Map<string, string>,
): Promise<boolean> {
  const taskIds = new Map<string, string>(created)
  for (const [nodeId, row] of replicas) taskIds.set(nodeId, row.id)

  const related = items.flatMap(item => {
    const remote = item.isArchived ? null : remoteRelations(item)
    const taskId = item.content ? taskIds.get(item.content.id) : undefined
    return remote && taskId ? [{ remote, taskId, row: replicas.get(item.content!.id) }] : []
  })

  const elsewhere = [
    ...new Set(related.flatMap(({ remote }) => [remote.parentNodeId, ...remote.blockedByNodeIds])),
  ].filter((nodeId): nodeId is string => nodeId !== null && !taskIds.has(nodeId))
  if (elsewhere.length > 0) {
    const rows = await prisma.task.findMany({ where: { remoteNodeId: { in: elsewhere } }, select: { id: true, remoteNodeId: true } })
    for (const row of rows) taskIds.set(row.remoteNodeId as string, row.id)
  }

  const writes: Prisma.PrismaPromise<unknown>[] = []
  const blockers: Prisma.TaskDependencyCreateManyInput[] = []
  for (const { remote, taskId, row } of related) {
    const plan = planRelations(
      remote,
      {
        taskId,
        parentTaskId: row?.parentTaskId ?? null,
        parentIsLocal: Boolean(row?.parentTaskId) && !row?.parentTask?.remoteNodeId,
        mirroredBlockerTaskIds: row?.blockedBy.map(dependency => dependency.blockingTaskId) ?? [],
      },
      nodeId => taskIds.get(nodeId),
    )
    if (plan.parentTaskId !== undefined) {
      writes.push(prisma.task.update({ where: { id: taskId }, data: { parentTaskId: plan.parentTaskId } }))
    }
    if (plan.removeBlockers.length > 0) {
      writes.push(prisma.taskDependency.deleteMany({ where: { blockedTaskId: taskId, blockingTaskId: { in: plan.removeBlockers } } }))
    }
    blockers.push(...plan.addBlockers.map(blockingTaskId => ({ blockedTaskId: taskId, blockingTaskId })))
  }
  // Straight to the table, not through task-dependency.service: its cycle
  // check is for Astrid writes, and GitHub's cycles are accepted (§8.4).
  if (blockers.length > 0) writes.push(prisma.taskDependency.createMany({ data: blockers, skipDuplicates: true }))

  if (writes.length > 0) await prisma.$transaction(writes)
  return writes.length > 0
}

const LABEL_LIST_SELECT = { id: true, remoteNodeId: true, name: true, color: true } as const

/**
 * Labels for one page (AWTD-1188): each GitHub label is a label-flavor list,
 * one per label node, and a task carries the label by being on it. The labels
 * a task holds ride on the page's replica read; the lists cost one read for
 * the page, and two more queries only when a label is new. A list belongs to
 * no project — a repo can feed several boards — and to the owner of the board
 * that met its label first.
 */
async function applyLabels(
  board: BoundBoard,
  items: RemoteProjectItem[],
  replicas: Map<string, ReplicaRow>,
  created: Map<string, string>,
): Promise<boolean> {
  const labelled = items.flatMap(item => {
    const remote = item.isArchived ? null : remoteLabels(item)
    const row = item.content ? replicas.get(item.content.id) : undefined
    const taskId = row?.id ?? (item.content ? created.get(item.content.id) : undefined)
    return remote && taskId ? [{ remote, taskId, held: row?.lists ?? [] }] : []
  })

  const seen = new Map<string, RemoteLabel & { repository: string | null }>()
  for (const { remote } of labelled) {
    for (const label of remote.labels) seen.set(label.nodeId, { ...label, repository: remote.repository })
  }

  const writes: Prisma.PrismaPromise<unknown>[] = []
  const listIds = new Map<string, string>()
  if (seen.size > 0) {
    const known = await prisma.taskList.findMany({ where: { remoteNodeId: { in: [...seen.keys()] } }, select: LABEL_LIST_SELECT })
    for (const list of known) {
      listIds.set(list.remoteNodeId as string, list.id)
      const drift = labelListDrift(seen.get(list.remoteNodeId as string)!, list)
      if (drift) writes.push(prisma.taskList.update({ where: { id: list.id }, data: drift }))
    }

    const fresh = [...seen.values()].filter(label => !listIds.has(label.nodeId))
    if (fresh.length > 0) {
      await prisma.taskList.createMany({
        data: fresh.map(label => ({
          name: label.name,
          color: labelListColor(label.color),
          description: label.repository,
          ownerId: board.ownerId,
          listType: LIST_TYPE_LABEL,
          remoteNodeId: label.nodeId,
        })),
        // Another job may have met the same label: the node id is unique.
        skipDuplicates: true,
      })
      const made = await prisma.taskList.findMany({
        where: { remoteNodeId: { in: fresh.map(label => label.nodeId) } },
        select: LABEL_LIST_SELECT,
      })
      for (const list of made) listIds.set(list.remoteNodeId as string, list.id)
      await RedisCache.invalidate.userLists(board.ownerId).catch(err => {
        log.warn({ err, projectId: board.projectId }, 'Failed to clear the board owner’s list cache')
      })
    }
  }

  for (const { remote, taskId, held } of labelled) {
    const plan = planLabels(remote, held.map(list => list.remoteNodeId as string))
    if (isEmptyLabelPlan(plan)) continue
    const connect = plan.join.flatMap(nodeId => (listIds.has(nodeId) ? [{ id: listIds.get(nodeId)! }] : []))
    const leaving = new Set(plan.leave)
    const disconnect = held.filter(list => leaving.has(list.remoteNodeId as string)).map(list => ({ id: list.id }))
    if (connect.length === 0 && disconnect.length === 0) continue
    writes.push(
      prisma.task.update({
        where: { id: taskId },
        data: { lists: { ...(connect.length > 0 ? { connect } : {}), ...(disconnect.length > 0 ? { disconnect } : {}) } },
      }),
    )
  }

  if (writes.length > 0) await prisma.$transaction(writes)
  return writes.length > 0
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
  const replicaByNode = new Map(replicaRows.map(row => [row.remoteNodeId as string, row]))
  const replicas = new Map(replicaRows.map(row => [row.remoteNodeId as string, row as unknown as ReplicaTask]))
  const createdByNode = new Map<string, string>()
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
    for (const task of tasks) createdByNode.set((task as unknown as { remoteNodeId: string }).remoteNodeId, task.id)
  }

  const relationsChanged = await applyRelations(items, replicaByNode, createdByNode)
  const labelsChanged = await applyLabels(board, items, replicaByNode, createdByNode)

  // createTasksInBulk clears caches for what it created; updates, leaves,
  // relationship and label changes are ours to clear.
  if (writes.length > 0 || relationsChanged || labelsChanged) {
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

/** The board a GitHub project is bound to, by its node id (webhooks name projects that way). */
export async function boardForProjectNode(projectNodeId: string) {
  const binding = await prisma.gitHubProjectBinding.findUnique({
    where: { projectNodeId },
    select: { projectId: true },
  })
  return binding ? boundBoard(binding.projectId) : null
}

/**
 * An item GitHub no longer has (deleted, or out of the installation's reach):
 * it leaves the board, and the task itself is kept (§8.7).
 */
export async function removeProjectItem(board: BoundBoard, itemNodeId: string): Promise<boolean> {
  const membership = await prisma.gitHubProjectItem.findUnique({
    where: { itemNodeId },
    select: { taskId: true, archived: true, projectId: true },
  })
  if (!membership || membership.archived || membership.projectId !== board.projectId) return false
  await prisma.$transaction([
    prisma.gitHubProjectItem.update({ where: { itemNodeId }, data: { archived: true } }),
    prisma.task.update({ where: { id: membership.taskId }, data: { lists: { disconnect: { id: board.listId } } } }),
  ])
  await RedisCache.invalidate.userTasks(board.ownerId, [board.listId]).catch(() => {})
  return true
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
