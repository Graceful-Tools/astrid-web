import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { buildNotificationRows, fanOutEvent, type NotificationRecordContext, type NotificationTarget, type TaskAudience } from '@/lib/notifications'
import type { TaskEventInput } from '@/lib/task-events'

const log = createLogger('notifications')

export async function persistNotifications(args: {
  targets: NotificationTarget[]
  context: NotificationRecordContext
  client?: typeof prisma
}): Promise<number> {
  const rows = buildNotificationRows(args.targets, args.context)
  if (rows.length === 0) return 0

  try {
    await (args.client ?? prisma).notification.createMany({ data: rows })
    return rows.length
  } catch (error) {
    log.error({ err: error, count: rows.length }, 'Failed to persist notifications')
    return 0
  }
}

/**
 * Fan a batch of task-update events out and persist in ONE call.
 *
 * The dedupe in buildNotificationRows is keyed userId:kind:taskId:commentId
 * and only spans a single persistNotifications call. diffTaskEvents emits one
 * list_added event per added list and several event kinds map to the same
 * notification kind, so persisting per-event writes byte-identical rows —
 * adding two lists in one PUT notified the assignee twice (task ceaff1c5).
 * Flat-mapping every event's targets into one persist restores the dedupe and
 * collapses the writes into a single createMany.
 */
export async function notifyTaskUpdate(args: {
  taskId: string
  actorId: string
  events: TaskEventInput[]
  audience: TaskAudience
  client?: typeof prisma
}): Promise<number> {
  return persistNotifications({
    targets: args.events.flatMap(event =>
      fanOutEvent({ kind: event.kind, actorId: args.actorId, audience: args.audience })
    ),
    context: { taskId: args.taskId, actorId: args.actorId },
    client: args.client,
  })
}
