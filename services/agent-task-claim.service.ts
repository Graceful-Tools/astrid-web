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
import type { Prisma } from '@prisma/client'
import type { RuntimeBindingDenial } from '@/lib/ai/runtime-binding-resolver'
import { gateBoundClaim, runFencedClaim } from '@/lib/runtime-binding/claim-fence'

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

function bindingDenied(denial: RuntimeBindingDenial): AgentTaskClaimResult {
  const { reason, bindingId, boardId, message } = denial
  return { outcome: 'binding_denied', task: null, binding: { reason, bindingId, boardId, message } }
}

export async function claimAgentTask(input: {
  taskId: string
  userId: string
  agentId: string
  action: AgentTaskClaimAction
  /** The agent's address, for the runtime-binding gate (AWTD-1669). */
  agentEmail?: string | null
  /** The caller's OAuth client id; null for any other authentication. */
  principal?: string | null
}): Promise<AgentTaskClaimResult> {
  const { taskId, userId, agentId, action } = input
  const found = await findAccessibleTask(taskId, userId)
  if (!('task' in found)) return { outcome: found.outcome, task: null }

  const task = found.task
  if (task.completed) return { outcome: 'not_ready', task: snapshot(task) }

  // The runtime-binding pilot (AWTD-1669). Off, or on an unbound task, this is
  // `legacy` with no query and the writes below run exactly as before. On a
  // bound task only the binding's runtime may act, and a claim is fenced.
  const gateInput = {
    taskId,
    agentEmail: input.agentEmail ?? null,
    principal: input.principal ?? null,
  }
  const operation = `claim:${action}`
  const binding = await gateBoundClaim(gateInput, { actorUserId: userId, operation })
  if (binding.kind === 'denied') return bindingDenied(binding.denial)
  const legacyClient = prisma as unknown as Prisma.TransactionClient
  type ClaimRows = AgentTaskClaimTask[]
  const runWrite = async (
    write: (db: Prisma.TransactionClient) => Promise<ClaimRows>,
    takesCapacity: boolean,
  ): Promise<ClaimRows | AgentTaskClaimResult> => {
    if (binding.kind !== 'bound') return write(legacyClient)
    const outcome = await runFencedClaim({
      plan: binding.plan,
      gate: gateInput,
      actorUserId: userId,
      operation,
      takesCapacity,
      write,
      started: rows => takesCapacity && rows.length === 1,
    })
    if (outcome.kind === 'denied') return bindingDenied(outcome.denial)
    return outcome.kind === 'stale' ? [] : outcome.value
  }

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
    // Another agent already holds it: the same answer whether this caller lost the
    // race or read the task just after the winner committed.
    if (task.statusRole === DOING_STATUS_ROLE && task.assigneeId) {
      return { outcome: 'conflict', task: snapshot(task) }
    }
    if (task.statusRole !== READY_STATUS_ROLE) {
      return { outcome: 'not_ready', task: snapshot(task) }
    }
    if (task.assigneeId && task.assigneeId !== agentId) {
      return { outcome: 'conflict', task: snapshot(task) }
    }

    const assigneeIds = [agentId, ...assigneeIdsOf(task).filter(id => id !== agentId)]
    const claimed = await runWrite(db => db.task.updateManyAndReturn({
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
    }), true)
    if (!Array.isArray(claimed)) return claimed
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
  // A release ends a run: it frees capacity and never needs it.
  const released = await runWrite(db => db.task.updateManyAndReturn({
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
  }), false)
  if (!Array.isArray(released)) return released
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
