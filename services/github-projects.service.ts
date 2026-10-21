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
 * (§13.3). What a replica holds (blockers, mirrored lists, field values) is
 * counted in the replica read and read only where it is held, and the board's
 * field schema is read once per board: an edited title costs 3 statements, not
 * the 10 it reached with P6a/P6c (AWTD-1297,
 * tests/services/github-projects-apply-query-budget.test.ts).
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { DEFAULT_LIST_COLOR } from '@/lib/brand/colors'
import { hasCapability } from '@/lib/brand/capabilities'
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
import {
  isEmptyMilestonePlan,
  MILESTONE_LIST_COLOR,
  milestoneListDescription,
  milestoneListDrift,
  planMilestone,
  remoteMilestone,
  type RemoteMilestone,
} from '@/lib/github/projects/milestones'
import { planAssignees, remoteAssignees } from '@/lib/github/projects/assignees'
import { assigneeIdsOf } from '@/lib/task-assignees'
import { readReplicas, type ReplicaRow } from '@/services/github-projects-replica'
import { LIST_TYPE_ITERATION, LIST_TYPE_LABEL, LIST_TYPE_MILESTONE } from '@/lib/list-flavors'
import { projectItemPages } from '@/lib/github/projects/hydrate'
import type { BindingProposal, ProjectSchema } from '@/lib/github/projects/bind'
import type { GraphqlClient } from '@/lib/github/rate-limiter'
import { installationGraphqlClient } from '@/lib/github/graphql-clients'
import { createTasksInBulk } from '@/services/task-bulk-create'
import {
  applyFieldPage,
  PROJECT_FIELD_SELECT,
  syncProjectFields,
  type ProjectFieldRow,
} from '@/services/github-project-fields.service'
import { applyIterationLists } from '@/services/github-iteration-lists.service'
// Labels and milestones moved next to the third mirrored flavor (AWTD-1315).
import { applyLabels, applyMilestones } from '@/services/github-mirrored-lists.service'
import { resolveHeldLists } from '@/lib/github/projects/held-lists'

const log = createLogger('services.github-projects')

/** A bound board, as the replica writer needs it. */
export interface BoundBoard {
  projectId: string
  listId: string
  ownerId: string
  /** PVT_…; lets a page refresh the board's field schema (AWTD-1117). */
  projectNodeId?: string
  binding: BindingFieldMap
  /** The board's field schema, read once per board (AWTD-1297); see FieldBoard. */
  fields?: ProjectFieldRow[]
}

export interface ApplySummary {
  created: number
  updated: number
  left: number
  unchanged: number
  skipped: number
}

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

/**
 * Assignees for one page (AWTD-1190): GitHub's people, matched by
 * `User.githubNodeId`, become the task's assigneeIds. One read for the page,
 * and none when nobody on it is assigned. A task created on this page starts
 * from nobody, whatever default the bulk create gave it.
 */
async function applyAssignees(
  items: RemoteProjectItem[],
  replicas: Map<string, ReplicaRow>,
  created: Map<string, string>,
): Promise<boolean> {
  const assigned = items.flatMap(item => {
    const remote = item.isArchived ? null : remoteAssignees(item)
    const row = item.content ? replicas.get(item.content.id) : undefined
    const taskId = row?.id ?? (item.content ? created.get(item.content.id) : undefined)
    return remote && taskId ? [{ remote, taskId, row }] : []
  })

  const nodeIds = [...new Set(assigned.flatMap(({ remote }) => remote))]
  const users =
    nodeIds.length > 0
      ? await prisma.user.findMany({ where: { githubNodeId: { in: nodeIds } }, select: { id: true, githubNodeId: true } })
      : []
  const userIdByNodeId = new Map(users.map(user => [user.githubNodeId as string, user.id]))

  const writes: Prisma.PrismaPromise<unknown>[] = []
  for (const { remote, taskId, row } of assigned) {
    const next = planAssignees({
      remote,
      held: row ? assigneeIdsOf(row) : [],
      primaryIsAgent: row?.assignee?.isAIAgent === true,
      userIdByNodeId,
    })
    if (next) writes.push(prisma.task.update({ where: { id: taskId }, data: { assigneeId: next[0] ?? null, assigneeIds: next } }))
  }

  if (writes.length > 0) await prisma.$transaction(writes)
  return writes.length > 0
}

/**
 * Apply one hydrated page of a project's items to its board. With a `client`,
 * a project field the board has not met refreshes its field schema (AWTD-1117).
 */
export async function applyProjectItems(board: BoundBoard, items: RemoteProjectItem[], client?: GraphqlClient): Promise<ApplySummary> {
  const summary: ApplySummary = { created: 0, updated: 0, left: 0, unchanged: 0, skipped: 0 }
  const contentIds = items.flatMap(item => (item.content?.id && item.type !== 'REDACTED' ? [item.content.id] : []))

  const [replicaRows, memberships] = await Promise.all([
    readReplicas(board.projectId, contentIds),
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
  /** Tasks this batch closes because GitHub closed them (AWTD-1118). */
  const completedOnGitHub: string[] = []

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
        // A close that happened on github.com, on a task that was open here.
        // This write never passes the completion path, so the recurrence
        // handoff has to be made from here too (AWTD-1118, §10.1).
        if (plan.patch.completed === true && !replica!.completed) completedOnGitHub.push(taskId)
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

  // A repeating task closed on github.com spawns its next occurrence, exactly
  // as completing it from Astrid does. Queued, so a GitHub hiccup retries
  // rather than losing the series; deduped per occurrence, so a close that
  // Astrid itself made does not spawn a second issue (§10.1).
  if (completedOnGitHub.length > 0) {
    const { enqueueRecurrenceForRemoteCompletions } = await import('@/services/github-recurrence.service')
    await enqueueRecurrenceForRemoteCompletions(completedOnGitHub)
  }

  const relationsChanged = await applyRelations(items, replicaByNode, createdByNode)
  const labelsChanged = await applyLabels(board, items, replicaByNode, createdByNode)
  const milestonesChanged = await applyMilestones(board, items, replicaByNode, createdByNode)
  const assigneesChanged = await applyAssignees(items, replicaByNode, createdByNode)
  // Project fields (AWTD-1117). An archived item's values leave with it.
  const fieldEntries = items.flatMap(item => {
    const nodeId = item.type !== 'REDACTED' ? item.content?.id : undefined
    const taskId = nodeId ? replicaByNode.get(nodeId)?.id ?? createdByNode.get(nodeId) : undefined
    return taskId && nodeId ? [{ item, taskId, nodeId }] : []
  })
  const fieldPage = await applyFieldPage(
    board,
    fieldEntries.map(({ item, taskId, nodeId }) => ({
      item,
      taskId,
      // A task created on this page holds nothing yet.
      holdsValues: replicaByNode.get(nodeId)?.holdsFieldValues ?? false,
    })),
    client,
  )
  const fieldsChanged = fieldPage.changed
  // Iterations (AWTD-1230) follow the values just stored, so they come after,
  // from what the field pass already holds rather than a second read.
  const iterationsChanged = await applyIterationLists(
    board,
    fieldEntries.map(({ taskId, nodeId }) => ({
      taskId,
      held: (replicaByNode.get(nodeId)?.lists ?? []).filter(list => list.listType === LIST_TYPE_ITERATION),
    })),
    fieldPage,
  )

  // createTasksInBulk clears caches for what it created; updates, leaves,
  // relationship, label, milestone, assignee, field and iteration changes are ours to clear.
  if (
    writes.length > 0 ||
    relationsChanged ||
    labelsChanged ||
    milestonesChanged ||
    assigneesChanged ||
    fieldsChanged ||
    iterationsChanged
  ) {
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
        select: {
          ownerId: true,
          lists: { where: { backend: GITHUB_PROJECT_BACKEND }, select: { id: true }, take: 1 },
          // Once per board, not once per page or per item event (AWTD-1297).
          fields: { select: PROJECT_FIELD_SELECT },
        },
      },
    },
  })
  const listId = binding?.project.lists[0]?.id
  if (!binding || !listId) return null
  return {
    projectId,
    listId,
    ownerId: binding.project.ownerId,
    ...(binding.project.fields ? { fields: binding.project.fields } : {}),
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
    // Its values for this project's fields leave with it (AWTD-1117).
    prisma.taskFieldValue.deleteMany({ where: { taskId: membership.taskId, projectId: board.projectId } }),
  ])
  await RedisCache.invalidate.userTasks(board.ownerId, [board.listId]).catch(() => {})
  return true
}

/** Page through every item and apply it (the initial import, §8.7). */
export async function importGitHubProject(projectId: string, client: GraphqlClient): Promise<ApplySummary> {
  const board = await boundBoard(projectId)
  if (!board) throw new Error(`Project ${projectId} is not bound to GitHub`)

  const total: ApplySummary = { created: 0, updated: 0, left: 0, unchanged: 0, skipped: 0 }
  await syncProjectFields(board, client)
  for await (const items of projectItemPages(client, board.projectNodeId)) {
    const page = await applyProjectItems(board, items, client)
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

/** Injected so the re-sync below can be driven in a test without a network. */
export interface UpdateBindingDeps {
  board: typeof boundBoard
  client: (installationId: number) => GraphqlClient
}

const updateBindingDefaults: UpdateBindingDeps = {
  board: boundBoard,
  // A read, and a person is waiting on it — 'hydrate' rather than
  // 'reconcile', whose 30% share is sized for background work.
  client: installationId => installationGraphqlClient(installationId, 'hydrate'),
}

/**
 * A field's `mappedTo` is DERIVED from the binding — `mappedTo()` in
 * lib/github/projects/fields.ts compares each field's remoteId against the
 * binding's status / priority / due field ids. So remapping due from field A
 * to field B makes two ProjectField rows wrong at once: A still says `due`,
 * and B says nothing.
 *
 * Nothing re-derived them on PATCH until AWTD-1209, so the replica stayed
 * wrong until the next hourly reconcile. That window is not cosmetic:
 * `planFieldValueWrite` refuses an edit to a mapped field, so it would have
 * refused B and allowed A — backwards, for up to an hour.
 *
 * **A failed re-sync does not fail the PATCH.** The mapping itself is already
 * stored, and the reconcile remains the backstop it always was; turning a
 * GitHub outage into a failed settings change would be the worse trade.
 */
export async function updateBindingMapping(
  projectId: string,
  patch: BindingPatch,
  deps: UpdateBindingDeps = updateBindingDefaults,
) {
  const updated = await prisma.gitHubProjectBinding.update({
    where: { projectId },
    data: {
      ...(patch.statusOptionMap !== undefined ? { statusOptionMap: patch.statusOptionMap } : {}),
      ...(patch.priorityFieldId !== undefined ? { priorityFieldId: patch.priorityFieldId } : {}),
      ...(patch.priorityOptionMap !== undefined ? { priorityOptionMap: patch.priorityOptionMap ?? Prisma.DbNull } : {}),
      ...(patch.dueFieldId !== undefined ? { dueFieldId: patch.dueFieldId } : {}),
    },
  })

  // Only the two field ids move a field's mappedTo. An option map names
  // values inside a field that is already mapped, so it changes nothing here.
  const remapped = patch.priorityFieldId !== undefined || patch.dueFieldId !== undefined
  if (remapped) {
    try {
      const board = await deps.board(projectId)
      if (board) await syncProjectFields(board, deps.client(board.installationId))
    } catch (error) {
      log.error({ err: error, projectId }, 'Binding changed but the field schema re-sync failed; the reconcile will correct it')
    }
  }

  return updated
}

/**
 * Unbind: the board stays as an ordinary Astrid board — a local snapshot of
 * what it mirrored (§11.2 DELETE). The tasks keep their remote identity so a
 * re-bind finds them rather than duplicating them.
 */
export async function unbindGitHubProject(projectId: string): Promise<void> {
  await prisma.$transaction([
    prisma.gitHubProjectBinding.delete({ where: { projectId } }),
    // Fields are GitHub's: a local board never has any (§9.4). Their values cascade.
    prisma.projectField.deleteMany({ where: { projectId } }),
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

/** Each bound board's GitHub-backed list, by board (Project) id — what a client opens (AWTD-1302). */
export async function boardListsForProjects(projectIds: string[]): Promise<Map<string, string>> {
  const lists = projectIds.length === 0 ? [] : await prisma.taskList.findMany({
    where: { projectId: { in: projectIds }, backend: GITHUB_PROJECT_BACKEND }, select: { id: true, projectId: true } })
  return new Map(lists.flatMap(list => (list.projectId ? [[list.projectId, list.id] as const] : [])))
}

/** A board's binding as the API shows it; null when the board is not bound. */
export function readBinding(projectId: string) {
  return prisma.gitHubProjectBinding.findUnique({ where: { projectId }, select: BINDING_SELECT })
}
