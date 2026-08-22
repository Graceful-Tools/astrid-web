import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { buildNotificationRows, type NotificationRecordContext, type NotificationTarget } from '@/lib/notifications'

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
