/**
 * Agent Task Scheduler
 *
 * Dispatches tasks to AI agents (Astrid) before their due dates.
 * Called by the reminders cron job every minute.
 *
 * Logic:
 * - Finds incomplete tasks with due dates in the next 30-60 minutes
 * - Checks if the task's assignee is an AI agent, OR if the task's list has a default agent
 * - Dispatches `agent_task_start` SSE event to the resolved agent
 * - Tracks dispatched tasks to avoid duplicate notifications
 */

import { prisma } from '@/lib/prisma'
import { broadcastToUsers } from '@/lib/sse-utils'
import { resolveDefaultAgent } from '@/lib/resolve-default-agent'
import { createLogger } from '@/lib/logger'

const log = createLogger('agent-task-scheduler')


// In-memory set of recently dispatched task IDs to avoid duplicate notifications
// (reset on server restart, which is fine — the DB check is the source of truth)
const recentlyDispatched = new Set<string>()

// Clean up old entries every hour
setInterval(() => recentlyDispatched.clear(), 60 * 60 * 1000)

/**
 * Process tasks that are due soon and dispatch them to their assigned AI agent.
 * Called every minute by the cron job.
 */
export async function processAgentTasksDueSoon(): Promise<number> {
  const now = new Date()
  const window30min = new Date(now.getTime() + 30 * 60 * 1000)
  const window60min = new Date(now.getTime() + 60 * 60 * 1000)

  try {
    // Find incomplete tasks with due dates in the next 30-60 minutes
    // We use a 30-60min window so agents get notified once, about 30-60min before due
    const tasks = await prisma.task.findMany({
      where: {
        completed: false,
        dueDateTime: {
          gte: window30min,
          lte: window60min,
        },
      },
      select: {
        id: true,
        title: true,
        description: true,
        dueDateTime: true,
        assigneeId: true,
        creatorId: true,
        assignee: {
          select: { id: true, isAIAgent: true, email: true },
        },
        lists: {
          select: { id: true, ownerId: true },
          take: 1,
        },
      },
    })

    let dispatched = 0

    for (const task of tasks) {
      // Skip if already dispatched recently
      if (recentlyDispatched.has(task.id)) continue

      let agentId: string | null = null

      // 1. If task is directly assigned to an AI agent, use that
      if (task.assignee?.isAIAgent) {
        agentId = task.assignee.id
      }

      // 2. Otherwise, resolve the default agent for the task's list/owner
      if (!agentId) {
        const listId = task.lists?.[0]?.id || null
        const ownerId = task.lists?.[0]?.ownerId || task.creatorId
        if (ownerId) {
          agentId = await resolveDefaultAgent(listId, ownerId)
        }
      }

      if (!agentId) continue

      // Dispatch the task to the agent
      await broadcastToUsers([agentId], {
        type: 'agent_task_start',
        timestamp: new Date().toISOString(),
        data: {
          taskId: task.id,
          taskTitle: task.title,
          taskDescription: task.description || '',
          dueDateTime: task.dueDateTime?.toISOString(),
          creatorId: task.creatorId,
          listId: task.lists?.[0]?.id || null,
          reason: 'due_soon',
        },
      })

      recentlyDispatched.add(task.id)
      dispatched++

      log.info(`🤖 Dispatched task "${task.title}" to agent ${agentId} (due ${task.dueDateTime?.toISOString()})`)
    }

    return dispatched
  } catch (error) {
    log.error({ err: error }, '[AgentTaskScheduler] Error processing due tasks:')
    return 0
  }
}
