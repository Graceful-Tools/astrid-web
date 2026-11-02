/**
 * The live events for a newly created task — `task_assigned` to its assignee,
 * `task_created` to everyone else on its lists.
 *
 * Taken out of services/task.service.ts (task 9377bc2c's size ratchet) when
 * AWTD-1040 added the full v1 task to them. Called by runCreateSideEffects,
 * after the creation comment exists, so `v1Task` matches what a fetch returns.
 * Best-effort like every other side effect: nothing here may fail the create.
 */

import { broadcastToUsers } from '@/lib/sse-utils'
import { getListMemberIds } from '@/lib/list-member-utils'
import { enrichTaskForAgent } from '@/lib/agent-protocol'
import { loadV1TaskForEvent } from '@/lib/tasks/v1-task-shape'
import { createLogger } from '@/lib/logger'
import type { CreatedTask } from '@/services/task.service'
import { actorHearsOwnChange } from '@/services/task-event-audience'

const log = createLogger('services.task')

/** Returns the members of the task's lists — the cache invalidation's audience too. */
export async function broadcastTaskCreated(args: {
  task: CreatedTask
  actorId: string
  creatorName: string
}): Promise<string[]> {
  const { task, actorId, creatorName } = args
  const anyTask = task as unknown as Record<string, any>
  const listNames = (anyTask.lists ?? []).map((list: any) => list.name)

  // Everyone who can see the list, the creator included — their OTHER devices
  // are separate connections and are exactly who needs this live (AWTD-1497).
  // Not the assignee: they get task_assigned below. An AI-agent creator hears
  // nothing of its own write (services/task-event-audience.ts).
  const actorHears = await actorHearsOwnChange(actorId)
  const memberIds = new Set<string>()
  for (const list of anyTask.lists ?? []) {
    getListMemberIds(list as never).forEach(id => memberIds.add(id))
  }
  const audience = new Set(memberIds)
  if (actorHears) audience.add(actorId)
  else audience.delete(actorId)
  const createdRecipients = Array.from(audience).filter(id => id !== task.assigneeId)
  const notifyAssignee = Boolean(task.assigneeId && (task.assigneeId !== actorId || actorHears))

  const v1Task =
    notifyAssignee || createdRecipients.length > 0 ? await loadV1TaskForEvent(task.id) : undefined

  if (notifyAssignee && task.assigneeId) {
    try {
      broadcastToUsers([task.assigneeId], {
        type: 'task_assigned',
        timestamp: new Date().toISOString(),
        data: {
          taskId: task.id,
          task: enrichTaskForAgent(task as never),
          v1Task,
          title: task.title,
          description: task.description,
          priority: task.priority,
          dueDateTime: task.dueDateTime,
          listId: anyTask.lists?.[0]?.id,
          listName: anyTask.lists?.[0]?.name,
          githubRepositoryId: anyTask.lists?.[0]?.githubRepositoryId,
          assignerName: creatorName,
          assignerId: anyTask.creator?.id ?? actorId,
          // Legacy field names, still read by older clients.
          taskTitle: task.title,
          taskPriority: task.priority,
          taskDueDateTime: task.dueDateTime,
          userId: actorId,
          listNames,
          comments: (anyTask.comments ?? []).map((c: any) => ({
            id: c.id,
            content: c.content,
            authorName: c.author?.name,
            createdAt: c.createdAt,
          })),
        },
      })
    } catch (err) {
      log.error({ err }, 'Failed to send task_assigned SSE notification')
    }
  }

  try {
    if (createdRecipients.length > 0) {
      broadcastToUsers(createdRecipients, {
        type: 'task_created',
        timestamp: new Date().toISOString(),
        data: {
          taskId: task.id,
          task: enrichTaskForAgent(task as never),
          v1Task,
          taskTitle: task.title,
          taskPriority: task.priority,
          taskDueDateTime: task.dueDateTime,
          creatorName,
          userId: actorId,
          listNames,
        },
      })
    }
  } catch (err) {
    log.error({ err }, 'Failed to send task_created SSE notifications')
  }
  return Array.from(memberIds)
}
