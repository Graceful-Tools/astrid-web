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
import { RedisCache, isRedisAvailable } from '@/lib/redis'
import { broadcastToUsers } from '@/lib/sse-utils'
import { resolveDefaultAgent } from '@/lib/resolve-default-agent'
import { createLogger } from '@/lib/logger'

const log = createLogger('agent-task-scheduler')


/**
 * Per-instance fallback for the dispatch claim.
 *
 * This used to be the ONLY guard, with a comment saying the DB check was the
 * source of truth — there is no DB check in this file, and never was. The
 * dispatch window is 30-60 minutes and the cron runs every minute, so each due
 * task is seen by roughly thirty consecutive runs; on a warm fleet a
 * module-level Set de-duplicates per INSTANCE, which means one dispatch per
 * instance rather than one dispatch. Every duplicate is a real agent run and
 * real model spend (task a7394c89).
 *
 * The claim below is now taken in Redis, which every instance shares. This
 * stays as the degraded path for when Redis is unavailable: better than
 * nothing, and no worse than what was here before.
 */
const recentlyDispatched = new Set<string>()

// Clean up old entries every hour
setInterval(() => recentlyDispatched.clear(), 60 * 60 * 1000)

/** Long enough to cover the whole 30-60 minute dispatch window, plus slack. */
const DISPATCH_CLAIM_TTL_SECONDS = 2 * 60 * 60

/**
 * True when THIS run should dispatch the task.
 *
 * Redis first, because it is shared; the in-memory set is consulted only when
 * Redis could not answer, so a cache outage degrades to the old behaviour
 * rather than dispatching thirty times.
 */
async function claimDispatch(taskId: string): Promise<boolean> {
  if (recentlyDispatched.has(taskId)) return false

  const won = await RedisCache.claimOnce(`agent-dispatch:${taskId}`, DISPATCH_CLAIM_TTL_SECONDS)
  if (won) {
    recentlyDispatched.add(taskId)
    return true
  }

  // Redis said no. That is either "another instance already has it" or "Redis
  // is unavailable"; claimOnce cannot distinguish, and both are answered the
  // same way — fall back to the local set, which at least stops this instance
  // repeating itself every minute.
  if (!(await isRedisAvailable())) {
    recentlyDispatched.add(taskId)
    return true
  }

  return false
}

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
      // Claim across every instance, not just this one.
      if (!(await claimDispatch(task.id))) continue

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

      // The claim above already recorded this locally; nothing to add here.
      dispatched++

      log.info(`🤖 Dispatched task "${task.title}" to agent ${agentId} (due ${task.dueDateTime?.toISOString()})`)
    }

    return dispatched
  } catch (error) {
    log.error({ err: error }, '[AgentTaskScheduler] Error processing due tasks:')
    return 0
  }
}
