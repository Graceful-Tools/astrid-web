import { createHash } from 'crypto'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { buildNotificationRows, taskUpdateNotificationTargets, type NotificationRecordContext, type NotificationTarget, type TaskAudience } from '@/lib/notifications'
import type { TaskEventInput } from '@/lib/task-events'

const log = createLogger('notifications')

/**
 * A row id derived from the work that produced it, so writing the same
 * notification twice is a no-op (AWTD-1462: a re-run task-updated job must not
 * notify twice). cuid-shaped — 'c' and 24 characters — like the default ids.
 */
function notificationIdFor(dedupeKey: string, row: { userId: string; kind: string }): string {
  return 'c' + createHash('sha256').update(`${dedupeKey}:${row.userId}:${row.kind}`).digest('hex').slice(0, 24)
}

export async function persistNotifications(args: {
  targets: NotificationTarget[]
  context: NotificationRecordContext
  client?: typeof prisma
  /** Names the work these rows come from; writing it again inserts nothing. */
  dedupeKey?: string
}): Promise<number> {
  const { dedupeKey } = args
  const built = buildNotificationRows(args.targets, args.context)
  if (built.length === 0) return 0
  const rows = dedupeKey ? built.map(row => ({ ...row, id: notificationIdFor(dedupeKey, row) })) : built

  try {
    await (args.client ?? prisma).notification.createMany({ data: rows, ...(dedupeKey ? { skipDuplicates: true } : {}) })
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
  dedupeKey?: string
}): Promise<number> {
  return persistNotifications({
    targets: taskUpdateNotificationTargets(args),
    context: { taskId: args.taskId, actorId: args.actorId },
    client: args.client,
    dedupeKey: args.dedupeKey,
  })
}
