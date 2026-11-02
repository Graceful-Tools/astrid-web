/**
 * The live events for an edited or completed task.
 *
 * Taken out of services/task.service.ts (the oversized-files ratchet) when the
 * editor's own devices were added (AWTD-1497).
 *
 * WHO HEARS IT
 * - Everyone in `audience` except the actor, as before.
 * - The actor too, but only when the write named the client that made it
 *   (`originClientId`, lib/realtime/client-id.ts). The event is tagged with
 *   that id and the originating connection drops it, so the actor's other
 *   devices and tabs update live while the tab that toggled never hears its
 *   own echo. That echo is what the 2026-09-08 completion-toggle storm
 *   investigation ruled out as an amplifier (task 8ef93fb9), and it stays
 *   ruled out.
 * - A write with no client id (older iOS builds, scripts) leaves the actor
 *   out entirely, as before. An AI-agent actor is always left out
 *   (services/task-event-audience.ts).
 *
 * Best-effort: the update is committed and the caller was told so.
 */

import { enrichTaskForAgent } from '@/lib/agent-protocol'
import { createLogger } from '@/lib/logger'
import { broadcastToUsers } from '@/lib/sse-utils'
import { loadV1TaskForEvent } from '@/lib/tasks/v1-task-shape'
import { actorHearsOwnChange } from '@/services/task-event-audience'

const log = createLogger('task-update-broadcast')

/** The users an update event goes to. Exported for the rule's tests. */
export async function updateEventRecipients(args: {
  audience: Iterable<string>
  actorId: string
  originClientId?: string | null
}): Promise<string[]> {
  const others = Array.from(args.audience).filter(id => id !== args.actorId)
  if (!args.originClientId) return others
  return (await actorHearsOwnChange(args.actorId)) ? [...others, args.actorId] : others
}

export async function broadcastTaskUpdated(args: {
  task: any
  existingTask: any
  /** Whether the write set the assignee: decides task_assigned. */
  assigneeWritten: boolean
  justCompleted: boolean
  audience: Set<string>
  /** The audience minus a former assignee off the task's lists (AWTD-1040). */
  viewers: Set<string>
  actorId: string
  actorName?: string
  legacySsePayload: boolean
  originClientId?: string | null
}): Promise<void> {
  const { task, existingTask, justCompleted, viewers, actorId, actorName, legacySsePayload, originClientId } = args
  try {
    const recipients = await updateEventRecipients({ audience: args.audience, actorId, originClientId })
    if (recipients.length === 0) return
    // Untagged writes keep the two-argument call: nothing changes for them.
    const send: typeof broadcastToUsers = (ids, event) =>
      originClientId ? broadcastToUsers(ids, event, { originClientId }) : broadcastToUsers(ids, event)

    // A new assignee gets task_assigned rather than task_updated — being
    // given work is a different event from work changing under you.
    const assigneeChanged = args.assigneeWritten && task.assigneeId !== existingTask.assigneeId

    // Re-read in the v1 shape rather than reshaping `task`: callers pass
    // their own include, and only the v1 read include is the GET's shape.
    const v1Task = await loadV1TaskForEvent(task.id)

    let updateRecipients = recipients
    if (assigneeChanged && task.assigneeId && task.assigneeId !== actorId) {
      send([task.assigneeId], {
        type: 'task_assigned',
        timestamp: new Date().toISOString(),
        data: { taskId: task.id, task: enrichTaskForAgent(task as never), v1Task },
      })
      updateRecipients = recipients.filter(id => id !== task.assigneeId)
    }

    const withFullTask = updateRecipients.filter(id => viewers.has(id))
    const leanOnly = updateRecipients.filter(id => !viewers.has(id))
    for (const [group, full] of [[withFullTask, true], [leanOnly, false]] as const) {
      if (group.length === 0) continue
      send(group, {
        type: justCompleted ? 'task_completed' : 'task_updated',
        timestamp: new Date().toISOString(),
        data: {
          taskId: task.id,
          task: enrichTaskForAgent(task as never),
          ...(full ? { v1Task } : {}),
          // The flat duplicates below are the WEB route's payload and only
          // its own: every field here is already inside `task`, and v1 and
          // the agent PATCH deliberately send the lean pair, which
          // tests/api/sse-event-delivery asserts.
          ...(legacySsePayload
            ? {
                taskTitle: task.title,
                taskPriority: task.priority,
                taskDueDateTime: task.dueDateTime,
                taskIsAllDay: task.isAllDay,
                taskCompleted: task.completed,
                updaterName: actorName || 'Someone',
                userId: actorId,
                listNames: (task.lists ?? []).map((list: any) => list.name),
              }
            : {}),
        },
      })
    }
  } catch (err) {
    log.error({ err }, 'Failed to broadcast task update SSE')
  }
}
