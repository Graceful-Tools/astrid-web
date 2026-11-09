import { assigneeIdsOf } from '@/lib/task-assignees'
import {
  DOING_STATUS_ROLE,
  READY_STATUS_ROLE,
} from '@/lib/task-status'
import { taskWriteAccessWhere } from '@/lib/api-auth-middleware'
import type {
  AgentTaskClaimAction,
  AgentTaskClaimResult,
  AgentTaskClaimTask,
} from '@/lib/agent-task-claim'
import { prisma } from '@/lib/prisma'

const CLAIM_TASK_SELECT = {
  id: true,
  statusRole: true,
  completed: true,
  assigneeId: true,
  assigneeIds: true,
  updatedAt: true,
} as const

function snapshot(task: AgentTaskClaimTask): AgentTaskClaimTask {
  return {
    id: task.id,
    statusRole: task.statusRole,
    completed: task.completed,
    assigneeId: task.assigneeId,
    assigneeIds: [...task.assigneeIds],
    updatedAt: task.updatedAt,
  }
}

async function findAccessibleTask(
  taskId: string,
  userId: string,
): Promise<{ task: AgentTaskClaimTask } | { outcome: 'not_found' | 'forbidden' }> {
  const task = await prisma.task.findFirst({
    where: { id: taskId, ...taskWriteAccessWhere(userId) },
    select: CLAIM_TASK_SELECT,
  })
  if (task) return { task }

  const exists = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true },
  })
  return exists ? { outcome: 'forbidden' } : { outcome: 'not_found' }
}

async function currentAccessibleTask(
  taskId: string,
  userId: string,
): Promise<AgentTaskClaimResult> {
  const found = await findAccessibleTask(taskId, userId)
  return 'task' in found
    ? { outcome: 'conflict', task: snapshot(found.task) }
    : { outcome: found.outcome, task: null }
}

export async function claimAgentTask(input: {
  taskId: string
  userId: string
  agentId: string
  action: AgentTaskClaimAction
}): Promise<AgentTaskClaimResult> {
  const { taskId, userId, agentId, action } = input
  const found = await findAccessibleTask(taskId, userId)
  if (!('task' in found)) return { outcome: found.outcome, task: null }

  const task = found.task
  if (task.completed) return { outcome: 'not_ready', task: snapshot(task) }

  if (action === 'resume') {
    return task.statusRole === DOING_STATUS_ROLE && task.assigneeId === agentId
      ? { outcome: 'already_yours', task: snapshot(task) }
      : task.statusRole === DOING_STATUS_ROLE
        ? { outcome: 'conflict', task: snapshot(task) }
        : { outcome: 'not_ready', task: snapshot(task) }
  }

  if (action === 'claim') {
    if (task.statusRole === DOING_STATUS_ROLE && task.assigneeId === agentId) {
      return { outcome: 'already_yours', task: snapshot(task) }
    }
    if (task.statusRole !== READY_STATUS_ROLE) {
      return { outcome: 'not_ready', task: snapshot(task) }
    }
    if (task.assigneeId && task.assigneeId !== agentId) {
      return { outcome: 'conflict', task: snapshot(task) }
    }

    const assigneeIds = [agentId, ...assigneeIdsOf(task).filter(id => id !== agentId)]
    const claimed = await prisma.task.updateManyAndReturn({
      where: {
        id: taskId,
        completed: false,
        statusRole: READY_STATUS_ROLE,
        assigneeIds: { equals: task.assigneeIds },
        AND: [
          taskWriteAccessWhere(userId),
          { OR: [{ assigneeId: null }, { assigneeId: agentId }] },
        ],
      },
      data: {
        assigneeId: agentId,
        assigneeIds,
        statusRole: DOING_STATUS_ROLE,
      },
      select: CLAIM_TASK_SELECT,
    })
    if (claimed.length === 1) {
      return { outcome: 'claimed', task: snapshot(claimed[0]) }
    }

    const current = await currentAccessibleTask(taskId, userId)
    if (current.outcome === 'conflict' && current.task) {
      if (current.task.completed) {
        return { outcome: 'not_ready', task: current.task }
      }
      if (current.task.statusRole === DOING_STATUS_ROLE) {
        return { outcome: 'conflict', task: current.task }
      }
      if (current.task.statusRole !== READY_STATUS_ROLE) {
        return { outcome: 'not_ready', task: current.task }
      }
    }
    return current
  }

  if (task.statusRole !== DOING_STATUS_ROLE) {
    return { outcome: 'not_ready', task: snapshot(task) }
  }
  if (task.assigneeId !== agentId) {
    return { outcome: 'conflict', task: snapshot(task) }
  }

  const assigneeIds = assigneeIdsOf(task).filter(id => id !== agentId)
  const released = await prisma.task.updateManyAndReturn({
    where: {
      id: taskId,
      completed: false,
      statusRole: DOING_STATUS_ROLE,
      assigneeId: agentId,
      assigneeIds: { equals: task.assigneeIds },
      AND: [taskWriteAccessWhere(userId)],
    },
    data: {
      assigneeId: assigneeIds[0] ?? null,
      assigneeIds,
      statusRole: READY_STATUS_ROLE,
    },
    select: CLAIM_TASK_SELECT,
  })
  if (released.length === 1) {
    return { outcome: 'released', task: snapshot(released[0]) }
  }

  const current = await currentAccessibleTask(taskId, userId)
  if (
    current.outcome === 'conflict' &&
    current.task &&
    (current.task.completed || current.task.statusRole !== DOING_STATUS_ROLE)
  ) {
    return { outcome: 'not_ready', task: current.task }
  }
  return current
}
