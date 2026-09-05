import { Prisma, type PrismaClient } from '@prisma/client'

import { createLogger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import {
  classifyWaitingTask,
  parseBlockedConditions,
  shouldParkScheduledReadyTask,
} from '@/lib/ready-queue-scope'
import {
  READY_STATUS_ROLE,
  WAITING_STATUS_ROLE,
} from '@/lib/task-status'

const log = createLogger('agent-lifecycle')
const DEFAULT_BATCH_SIZE = 100
const SERIALIZABLE_RETRY_LIMIT = 3

type LifecycleClient = Pick<PrismaClient, '$transaction'>

export interface AgentLifecycleListSnapshot {
  id: string
  listType?: string | null
  agentLifecycleEnabled: boolean
}

export interface AgentLifecycleTaskSnapshot {
  id: string
  completed: boolean
  statusRole: string | null
  dueDateTime: Date | string | null
  assigneeId: string | null
  assignee: { isAIAgent: boolean } | null
  lists: AgentLifecycleListSnapshot[]
  comments: Array<{
    content: string | null
    createdAt: Date | string | null
  }>
  openBlockerIds?: string[]
}

export interface AgentLifecycleTransition {
  from: typeof READY_STATUS_ROLE | typeof WAITING_STATUS_ROLE
  to: typeof READY_STATUS_ROLE | typeof WAITING_STATUS_ROLE
  reason: 'scheduled' | 'condition-met'
  comment: string
}

export type AgentLifecycleTaskResult =
  | { outcome: 'transitioned'; taskId: string; transition: AgentLifecycleTransition }
  | { outcome: 'unchanged'; taskId: string }

export interface AgentLifecycleBatchResult {
  scanned: number
  transitioned: number
  unchanged: number
}

function normalizedStatus(statusRole: string | null): string {
  return (statusRole ?? '').trim().toLowerCase()
}

function hasFullyOptedInBoardScope(lists: AgentLifecycleListSnapshot[]): boolean {
  const boards = lists.filter(list => list.listType !== 'status')
  return boards.length > 0 && boards.every(list => list.agentLifecycleEnabled)
}

function isAgentManaged(task: AgentLifecycleTaskSnapshot): boolean {
  if (!task.assigneeId) return true
  return task.assignee?.isAIAgent === true
}

function dueValue(value: Date | string | null): string | null {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : value
}

export function decideAgentLifecycleTransition(
  task: AgentLifecycleTaskSnapshot,
  now = new Date(),
): AgentLifecycleTransition | null {
  if (task.completed || !hasFullyOptedInBoardScope(task.lists) || !isAgentManaged(task)) {
    return null
  }

  const status = normalizedStatus(task.statusRole)
  if (status === READY_STATUS_ROLE) {
    if (!shouldParkScheduledReadyTask({ dueDateTime: dueValue(task.dueDateTime) }, now)) {
      return null
    }
    return {
      from: READY_STATUS_ROLE,
      to: WAITING_STATUS_ROLE,
      reason: 'scheduled',
      comment: 'Scheduled for a future date - automatically moved from Ready to Waiting.',
    }
  }

  if (status !== WAITING_STATUS_ROLE) {
    return null
  }

  const conditions = parseBlockedConditions(
    task.comments.map(comment => ({
      content: comment.content,
      createdAt: comment.createdAt instanceof Date
        ? comment.createdAt.toISOString()
        : comment.createdAt,
    })),
  )
  const hadBlockers = conditions.blockedBy.length > 0
  if (hadBlockers && (task.openBlockerIds === undefined || task.openBlockerIds.length > 0)) {
    return null
  }

  const disposition = classifyWaitingTask({
    dueDateTime: dueValue(task.dueDateTime),
    now,
    blockedBy: [],
    blockedOn: conditions.blockedOn,
  })

  if (disposition !== 'promote' && !(hadBlockers && disposition === 'review')) {
    return null
  }

  return {
    from: WAITING_STATUS_ROLE,
    to: READY_STATUS_ROLE,
    reason: 'condition-met',
    comment: 'Date arrived or blockers completed - automatically moved from Waiting to Ready.',
  }
}

function isSerializableConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034'
}

async function withSerializableRetry<T>(
  client: LifecycleClient,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= SERIALIZABLE_RETRY_LIMIT; attempt += 1) {
    try {
      return await client.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      })
    } catch (error) {
      if (!isSerializableConflict(error) || attempt === SERIALIZABLE_RETRY_LIMIT) {
        throw error
      }
      log.warn({ attempt }, 'Retrying lifecycle reconciliation after serializable conflict')
    }
  }
  throw new Error('Unreachable lifecycle reconciliation retry state')
}

async function readTaskSnapshot(
  tx: Prisma.TransactionClient,
  taskId: string,
): Promise<AgentLifecycleTaskSnapshot | null> {
  const task = await tx.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      completed: true,
      statusRole: true,
      dueDateTime: true,
      assigneeId: true,
      assignee: { select: { isAIAgent: true } },
      lists: {
        select: {
          id: true,
          listType: true,
          agentLifecycleEnabled: true,
        },
      },
      comments: {
        select: { content: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  })
  if (!task) return null

  const conditions = parseBlockedConditions(
    task.comments.map(comment => ({
      content: comment.content,
      createdAt: comment.createdAt.toISOString(),
    })),
  )
  let openBlockerIds: string[] | undefined
  if (conditions.blockedBy.length > 0) {
    const blockers = await tx.task.findMany({
      where: { id: { in: conditions.blockedBy } },
      select: { id: true, completed: true },
    })
    const completionById = new Map(blockers.map(blocker => [blocker.id, blocker.completed]))
    openBlockerIds = conditions.blockedBy.filter(id => completionById.get(id) !== true)
  }

  return { ...task, openBlockerIds }
}

function finalEligibilityWhere(
  task: AgentLifecycleTaskSnapshot,
  transition: AgentLifecycleTransition,
): Prisma.TaskWhereInput {
  return {
    id: task.id,
    completed: false,
    statusRole: task.statusRole,
    OR: [
      { assigneeId: null },
      { assignee: { is: { isAIAgent: true } } },
    ],
    lists: {
      some: {
        listType: { not: 'status' },
        agentLifecycleEnabled: true,
      },
      none: {
        listType: { not: 'status' },
        agentLifecycleEnabled: false,
      },
    },
    ...(transition.from === READY_STATUS_ROLE
      ? { dueDateTime: task.dueDateTime instanceof Date ? task.dueDateTime : new Date(task.dueDateTime as string) }
      : {}),
  }
}

export async function reconcileAgentLifecycleTask(
  taskId: string,
  options: {
    client?: LifecycleClient
    now?: Date
  } = {},
): Promise<AgentLifecycleTaskResult> {
  const client = options.client ?? prisma
  const now = options.now ?? new Date()

  return withSerializableRetry(client, async tx => {
    const initialTask = await readTaskSnapshot(tx, taskId)
    if (!initialTask) return { outcome: 'unchanged', taskId }

    const initialTransition = decideAgentLifecycleTransition(initialTask, now)
    if (!initialTransition) return { outcome: 'unchanged', taskId }

    // Re-read every eligibility input immediately before the conditional write.
    // The serializable transaction then turns overlapping mutations into a
    // retry instead of allowing a stale blocker, assignee, or board setting.
    const task = await readTaskSnapshot(tx, taskId)
    if (!task) return { outcome: 'unchanged', taskId }
    const transition = decideAgentLifecycleTransition(task, now)
    if (
      !transition ||
      transition.from !== initialTransition.from ||
      transition.to !== initialTransition.to
    ) {
      return { outcome: 'unchanged', taskId }
    }

    const updated = await tx.task.updateMany({
      where: finalEligibilityWhere(task, transition),
      data: { statusRole: transition.to },
    })
    if (updated.count !== 1) {
      return { outcome: 'unchanged', taskId }
    }

    await tx.taskEvent.create({
      data: {
        taskId,
        actorId: null,
        actorType: 'system',
        kind: 'status_changed',
        from: transition.from,
        to: transition.to,
      },
    })
    await tx.comment.create({
      data: {
        taskId,
        authorId: null,
        type: 'TEXT',
        content: transition.comment,
      },
    })

    return { outcome: 'transitioned', taskId, transition }
  })
}

export async function reconcileAgentLifecycleBoard(
  boardId: string,
  options: {
    client?: typeof prisma
    now?: Date
    batchSize?: number
  } = {},
): Promise<AgentLifecycleBatchResult> {
  const client = options.client ?? prisma
  const now = options.now ?? new Date()
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
  const enabledBoard = await client.taskList.findFirst({
    where: {
      id: boardId,
      listType: { not: 'status' },
      agentLifecycleEnabled: true,
    },
    select: { id: true, agentLifecycleCursor: true },
  })
  if (!enabledBoard) return { scanned: 0, transitioned: 0, unchanged: 0 }

  const result: AgentLifecycleBatchResult = { scanned: 0, transitioned: 0, unchanged: 0 }
  const readBatch = (cursor?: string | null) =>
    client.task.findMany({
      where: {
        completed: false,
        statusRole: { in: [READY_STATUS_ROLE, WAITING_STATUS_ROLE] },
        lists: { some: { id: boardId } },
      },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })

  let tasks = await readBatch(enabledBoard.agentLifecycleCursor)
  if (tasks.length === 0 && enabledBoard.agentLifecycleCursor) {
    tasks = await readBatch()
  }
  for (const task of tasks) {
    const taskResult = await reconcileAgentLifecycleTask(task.id, { client, now })
    result.scanned += 1
    if (taskResult.outcome === 'transitioned') result.transitioned += 1
    else result.unchanged += 1
  }
  await client.taskList.updateMany({
    where: { id: boardId, agentLifecycleEnabled: true },
    data: {
      agentLifecycleCursor: tasks.length === batchSize ? tasks.at(-1)?.id : null,
    },
  })

  return result
}

export async function reconcileAgentLifecycleDependents(
  completedTaskId: string,
  options: { client?: typeof prisma; now?: Date } = {},
): Promise<AgentLifecycleBatchResult> {
  const client = options.client ?? prisma
  const candidates = await client.comment.findMany({
    where: {
      content: { contains: `BLOCKED-BY: ${completedTaskId}`, mode: 'insensitive' },
      task: { completed: false, statusRole: WAITING_STATUS_ROLE },
    },
    select: { taskId: true },
    distinct: ['taskId'],
  })
  const result: AgentLifecycleBatchResult = { scanned: 0, transitioned: 0, unchanged: 0 }
  for (const candidate of candidates) {
    const taskResult = await reconcileAgentLifecycleTask(candidate.taskId, {
      client,
      now: options.now,
    })
    result.scanned += 1
    if (taskResult.outcome === 'transitioned') result.transitioned += 1
    else result.unchanged += 1
  }
  return result
}

export async function reconcileAgentLifecycleAfterTaskMutation(
  taskId: string,
  options: {
    completed?: boolean
    client?: typeof prisma
    now?: Date
  } = {},
): Promise<AgentLifecycleBatchResult> {
  const taskResult = await reconcileAgentLifecycleTask(taskId, options)
  const result: AgentLifecycleBatchResult = {
    scanned: 1,
    transitioned: taskResult.outcome === 'transitioned' ? 1 : 0,
    unchanged: taskResult.outcome === 'unchanged' ? 1 : 0,
  }

  if (options.completed) {
    const dependents = await reconcileAgentLifecycleDependents(taskId, options)
    result.scanned += dependents.scanned
    result.transitioned += dependents.transitioned
    result.unchanged += dependents.unchanged
  }

  return result
}

export async function reconcileAllAgentLifecycleBoards(
  options: { client?: typeof prisma; now?: Date; batchSize?: number } = {},
): Promise<AgentLifecycleBatchResult> {
  const client = options.client ?? prisma
  const boards = await client.taskList.findMany({
    where: {
      listType: { not: 'status' },
      agentLifecycleEnabled: true,
    },
    select: { id: true },
    orderBy: { id: 'asc' },
  })
  const total: AgentLifecycleBatchResult = { scanned: 0, transitioned: 0, unchanged: 0 }
  for (const board of boards) {
    const result = await reconcileAgentLifecycleBoard(board.id, options)
    total.scanned += result.scanned
    total.transitioned += result.transitioned
    total.unchanged += result.unchanged
  }
  return total
}
