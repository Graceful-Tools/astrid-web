/**
 * Creating many tasks at once, with each side effect paid once per batch
 * (AWTD-1124).
 *
 * List and task copies used to write their rows raw (lib/copy-utils.ts,
 * lib/task-batch-copy.ts), so a copied task got no `AST-nnn` identifier, no
 * reminders, no place in a manually sorted list and no live event. Routing
 * each copy through createTaskWithSideEffects would fix that and blow the
 * function budget: a 500-task list copy would pay 500 identifier allocations,
 * 500 manual-sort rewrites of the same list, 500 reminder inserts.
 *
 * So the batch pays them once:
 *
 *   - one sequence range per project (allocateSequenceRange)
 *   - one row insert for every task, ids made up front
 *   - one write per list — its memberships and its manual-sort append together
 *   - one comment insert — creation comments and any carried history
 *   - one reminder insert
 *   - one v1-shape read for the events, and the cache cleared once per user
 *
 * The rows, memberships and comments commit together, so a failure never
 * leaves a task on no list. Everything after the commit is best-effort, as in
 * createTaskWithSideEffects: the tasks exist, and a missed reminder is not a
 * reason to report that they don't.
 *
 * AUTHORISATION is the caller's. A copy has already decided who may read the
 * source and write the targets — the copy flows differ there on purpose — and
 * hands over finished column values. What this owns is what a create MEANS.
 */

import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { allocateSequenceRange, ensureProjectKey, formatIdentifier } from '@/lib/task-identifier'
import { computeAutomaticReminders, type ReminderScheduleEntry } from '@/lib/reminder-scheduling'
import { taskBackendFor } from '@/lib/backends/resolve'
import { broadcastToUsers } from '@/lib/sse-utils'
import { getListMemberIds } from '@/lib/list-member-utils'
import { broadcastListEvent } from '@/lib/lists/v1-list-shape'
import { enrichTaskForAgent } from '@/lib/agent-protocol'
import { loadV1TasksForEvent } from '@/lib/tasks/v1-task-shape'
import { RedisCache, isRedisAvailable } from '@/lib/redis'
import { dispatchAgentAssignment } from '@/services/agent-assignment-dispatch'
import { TASK_CREATE_INCLUDE, type CreatedTask } from '@/services/task-includes'
import { createLogger } from '@/lib/logger'

const log = createLogger('services.task-bulk-create')

/** Column values only. The service owns id, creator, identifier and lists. */
export type BulkTaskData = Omit<
  Prisma.TaskCreateManyInput,
  'id' | 'creatorId' | 'identifier' | 'sequence'
>

export interface BulkTaskInput {
  data: BulkTaskData
  listIds: string[]
  /** History carried over verbatim — a copy keeps its comments' authors. */
  comments?: Array<{ content: string; authorId: string | null }>
}

export interface BulkCreateResult {
  /** In input order, minus any row the backend refused. */
  tasks: CreatedTask[]
  rejected?: Array<{ index: number; status: number; error: string }>
}

export async function createTasksInBulk(args: {
  tasks: BulkTaskInput[]
  actorId: string
  /** Shown in the creation comments; looked up when omitted. */
  actorName?: string
}): Promise<BulkCreateResult> {
  const { actorId } = args
  if (args.tasks.length === 0) return { tasks: [] }

  // The TaskBackend seam, per row as createTaskWithSideEffects does — local
  // accepts everything; a remote backend may refuse one task of the batch.
  const accepted: Array<{ input: BulkTaskInput; data: BulkTaskData; id: string }> = []
  const rejected: NonNullable<BulkCreateResult['rejected']> = []
  for (const [index, input] of args.tasks.entries()) {
    const verdict = await taskBackendFor(input.listIds).createTask({ actorId }, input.data as never)
    if (verdict.ok) accepted.push({ input, data: verdict.value as BulkTaskData, id: randomUUID() })
    else rejected.push({ index, status: verdict.status, error: verdict.error })
  }
  if (accepted.length === 0) return { tasks: [], rejected }

  const creatorName = args.actorName || (await actorDisplayName(actorId))
  const allListIds = Array.from(new Set(accepted.flatMap(row => row.input.listIds)))

  const tasksByList = new Map<string, string[]>()
  for (const row of accepted) {
    for (const listId of row.input.listIds) {
      tasksByList.set(listId, [...(tasksByList.get(listId) ?? []), row.id])
    }
  }

  const manualLists: Array<Record<string, any>> = []
  await prisma.$transaction(
    async tx => {
      const lists = await tx.taskList.findMany({
        where: { id: { in: allListIds } },
        select: { id: true, projectId: true, sortBy: true, manualSortOrder: true },
        orderBy: { createdAt: 'asc' },
      })

      const identifiers = await mintIdentifierRanges(accepted, lists, tx)

      await tx.task.createMany({
        data: accepted.map(row => ({
          ...row.data,
          id: row.id,
          creatorId: actorId,
          identifier: identifiers.get(row.id)?.identifier ?? null,
          sequence: identifiers.get(row.id)?.sequence ?? null,
        })),
      })

      for (const list of lists) {
        const taskIds = tasksByList.get(list.id) ?? []
        if (taskIds.length === 0) continue
        const isManual = list.sortBy === 'manual'
        const existingOrder = Array.isArray(list.manualSortOrder)
          ? list.manualSortOrder.filter((id): id is string => typeof id === 'string')
          : []
        const updated = await tx.taskList.update({
          where: { id: list.id },
          data: {
            tasks: { connect: taskIds.map(id => ({ id })) },
            ...(isManual ? { manualSortOrder: [...existingOrder, ...taskIds] as Prisma.JsonArray } : {}),
          },
          include: {
            owner: { select: { id: true, name: true, email: true, image: true } },
            listMembers: { select: { userId: true, role: true } },
          },
        })
        if (isManual) manualLists.push(updated)
      }

      const comments = accepted.flatMap(row => [
        { taskId: row.id, authorId: null, content: `${creatorName} created this task`, type: 'TEXT' as const },
        ...(row.input.comments ?? []).map(comment => ({
          taskId: row.id,
          authorId: comment.authorId,
          content: comment.content,
        })),
      ])
      await tx.comment.createMany({ data: comments })
    },
    // A 500-task copy is a few statements, but large ones; the default 5s is
    // tuned for a single-row write.
    { timeout: 30_000 }
  )

  const created = await prisma.task.findMany({
    where: { id: { in: accepted.map(row => row.id) } },
    include: TASK_CREATE_INCLUDE,
  })
  const byId = new Map(created.map(task => [task.id, task as CreatedTask]))
  const tasks = accepted.map(row => byId.get(row.id)).filter((t): t is CreatedTask => Boolean(t))

  await runBulkCreateSideEffects({ tasks, actorId, creatorName, manualLists, allListIds })

  return rejected.length > 0 ? { tasks, rejected } : { tasks }
}

/**
 * One sequence range per project. A task's project is its first project list
 * by creation order — the rule allocateTaskIdentifier applies to one task.
 * Best-effort per project: no identifier beats a failed copy.
 */
async function mintIdentifierRanges(
  rows: Array<{ input: BulkTaskInput; id: string }>,
  lists: Array<{ id: string; projectId: string | null }>,
  tx: Prisma.TransactionClient
): Promise<Map<string, { identifier: string; sequence: number }>> {
  const byProject = new Map<string, string[]>()
  for (const row of rows) {
    const projectId = lists.find(list => list.projectId && row.input.listIds.includes(list.id))?.projectId
    if (projectId) byProject.set(projectId, [...(byProject.get(projectId) ?? []), row.id])
  }

  const minted = new Map<string, { identifier: string; sequence: number }>()
  for (const [projectId, taskIds] of byProject) {
    try {
      if (!(await ensureProjectKey(projectId, tx))) continue
      const range = await allocateSequenceRange(projectId, taskIds.length, tx)
      if (!range?.key) continue
      taskIds.forEach((taskId, offset) => {
        const sequence = range.firstSequence + offset
        minted.set(taskId, { identifier: formatIdentifier(range.key as string, sequence), sequence })
      })
    } catch (err) {
      log.error({ err, projectId }, 'Failed to allocate an identifier range')
    }
  }
  return minted
}

async function actorDisplayName(actorId: string): Promise<string> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: actorId },
      select: { name: true, email: true },
    })
    return user?.name || user?.email || 'Someone'
  } catch {
    return 'Someone'
  }
}

/** Everything after the commit. Each step guarded; none may fail the create. */
async function runBulkCreateSideEffects(args: {
  tasks: CreatedTask[]
  actorId: string
  creatorName: string
  manualLists: Array<Record<string, any>>
  allListIds: string[]
}): Promise<void> {
  const { tasks, actorId, creatorName, manualLists, allListIds } = args

  try {
    const reminders = tasks.flatMap(task => remindersFor(task).map(reminder => ({
      taskId: task.id,
      userId: task.assigneeId || actorId,
      scheduledFor: reminder.scheduledFor,
      type: reminder.type,
      status: 'pending',
      data: {
        taskTitle: task.title,
        taskId: task.id,
        source: reminder.source,
        ...(task.reminderType ? { reminderType: task.reminderType } : {}),
      },
    })))
    if (reminders.length > 0) await prisma.reminderQueue.createMany({ data: reminders })
  } catch (err) {
    log.error({ err }, 'Failed to schedule reminders for bulk-created tasks')
  }

  // The manual orders changed: each viewer gets the list, as one create does.
  for (const list of manualLists) {
    try {
      await broadcastListEvent({
        listId: list.id,
        recipients: getListMemberIds(list as never),
        type: 'list_updated',
        data: list as never,
      })
    } catch (err) {
      log.error({ err, listId: list.id }, 'Failed to announce manual sort order')
    }
  }

  const memberIds = new Set<string>()
  try {
    await broadcastBulkCreated({ tasks, actorId, creatorName, memberIds })
  } catch (err) {
    log.error({ err }, 'Failed to send live events for bulk-created tasks')
  }

  for (const task of tasks) {
    if (!task.assigneeId) continue
    await dispatchAgentAssignment({
      taskId: task.id,
      assigneeId: task.assigneeId,
      assignee: (task as unknown as Record<string, any>).assignee,
    })
  }

  try {
    if (await isRedisAvailable()) {
      const affected = new Set<string>([actorId, ...memberIds])
      tasks.forEach(task => task.assigneeId && affected.add(task.assigneeId))
      if (manualLists.length > 0) {
        manualLists.forEach(list => getListMemberIds(list as never).forEach(id => affected.add(id)))
      }
      await Promise.all(
        Array.from(affected).map(userId => RedisCache.invalidate.userTasks(userId, allListIds))
      )
      if (manualLists.length > 0) {
        await Promise.all(
          Array.from(affected).map(userId => RedisCache.invalidate.userListsAllVersions(userId))
        )
      }
    }
  } catch (err) {
    log.error({ err }, 'Failed to invalidate task cache after bulk creation')
  }
}

function remindersFor(task: CreatedTask): ReminderScheduleEntry[] {
  if (task.reminderTime) {
    return [{ scheduledFor: task.reminderTime, type: 'due_reminder', source: 'explicit' }]
  }
  if (task.dueDateTime) return computeAutomaticReminders(new Date(task.dueDateTime), 'automatic')
  return []
}

/**
 * `task_created` to everyone else on a task's lists, `task_assigned` to its
 * assignee — the events broadcastTaskCreated sends for one task, with the v1
 * shapes read in one query. Clients apply events per task, so one event per
 * task it is; a copy into a list nobody else can see sends none.
 */
async function broadcastBulkCreated(args: {
  tasks: CreatedTask[]
  actorId: string
  creatorName: string
  /** Filled with every member of every list — the cache's audience too. */
  memberIds: Set<string>
}): Promise<void> {
  const { tasks, actorId, creatorName, memberIds } = args

  const audiences = new Map<string, string[]>()
  for (const task of tasks) {
    const anyTask = task as unknown as Record<string, any>
    const members = new Set<string>()
    for (const list of anyTask.lists ?? []) {
      getListMemberIds(list as never).forEach(id => {
        members.add(id)
        memberIds.add(id)
      })
    }
    audiences.set(task.id, Array.from(members).filter(id => id !== actorId && id !== task.assigneeId))
  }

  const needsEvent = tasks.filter(
    task => audiences.get(task.id)!.length > 0 || (task.assigneeId && task.assigneeId !== actorId)
  )
  if (needsEvent.length === 0) return
  const v1Tasks = await loadV1TasksForEvent(needsEvent.map(task => task.id))

  for (const task of needsEvent) {
    const anyTask = task as unknown as Record<string, any>
    const listNames = (anyTask.lists ?? []).map((list: any) => list.name)
    const common = {
      taskId: task.id,
      task: enrichTaskForAgent(task as never),
      v1Task: v1Tasks.get(task.id),
      taskTitle: task.title,
      taskPriority: task.priority,
      taskDueDateTime: task.dueDateTime,
      userId: actorId,
      listNames,
    }
    const recipients = audiences.get(task.id)!
    if (recipients.length > 0) {
      await broadcastToUsers(recipients, {
        type: 'task_created',
        timestamp: new Date().toISOString(),
        data: { ...common, creatorName },
      })
    }
    if (task.assigneeId && task.assigneeId !== actorId) {
      await broadcastToUsers([task.assigneeId], {
        type: 'task_assigned',
        timestamp: new Date().toISOString(),
        data: {
          ...common,
          title: task.title,
          description: task.description,
          priority: task.priority,
          dueDateTime: task.dueDateTime,
          listId: anyTask.lists?.[0]?.id,
          listName: anyTask.lists?.[0]?.name,
          githubRepositoryId: anyTask.lists?.[0]?.githubRepositoryId,
          assignerName: creatorName,
          assignerId: actorId,
        },
      })
    }
  }
}
