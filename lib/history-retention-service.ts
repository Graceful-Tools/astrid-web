/**
 * The Prisma half of history retention (AWTD-1455). Windows, the kept kinds and
 * the on/off switch live in lib/history-retention.ts.
 *
 * DRY-RUN UNLESS SWITCHED ON. With `HISTORY_RETENTION_PRUNE` unset this only
 * counts the rows each window would remove and logs those counts — nothing is
 * deleted. Set it to `delete` to prune.
 *
 * BATCHED. Prisma's deleteMany has no LIMIT, so each batch selects up to
 * HISTORY_PRUNE_BATCH_SIZE ids and deletes those, for at most
 * HISTORY_PRUNE_MAX_BATCHES batches per table per run. A backlog drains over
 * a few nights rather than in one statement.
 *
 * Like the other prunes in the nightly cron, a failure is logged and reads as
 * zero: housekeeping must never fail the aggregation it runs after.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { createLogger } from './logger'
import {
  HISTORY_PRUNE_BATCH_SIZE,
  HISTORY_PRUNE_MAX_BATCHES,
  TASK_EVENT_KEPT_KINDS,
  historyCutoffs,
  historyPruneMode,
  type HistoryPruneMode,
} from './history-retention'

const log = createLogger('history-retention')

export interface HistoryPruneSummary {
  mode: HistoryPruneMode
  /** Rows deleted — or, in dry-run, rows that WOULD be deleted. */
  taskEvents: number
  analyticsEvents: number
  notifications: number
}

export function taskEventPruneWhere(cutoff: Date): Prisma.TaskEventWhereInput {
  return { createdAt: { lt: cutoff }, kind: { notIn: [...TASK_EVENT_KEPT_KINDS] } }
}

export function analyticsEventPruneWhere(cutoff: Date): Prisma.AnalyticsEventWhereInput {
  return { createdAt: { lt: cutoff } }
}

export function notificationPruneWhere(readCutoff: Date, cutoff: Date): Prisma.NotificationWhereInput {
  return { OR: [{ readAt: { lt: readCutoff } }, { createdAt: { lt: cutoff } }] }
}

interface PrunableDelegate {
  count(args: { where: unknown }): Promise<number>
  findMany(args: { where: unknown; select: { id: true }; take: number }): Promise<Array<{ id: string }>>
  deleteMany(args: { where: { id: { in: string[] } } }): Promise<{ count: number }>
}

async function pruneTable(
  table: string,
  delegate: PrunableDelegate,
  where: unknown,
  mode: HistoryPruneMode,
): Promise<number> {
  try {
    if (mode === 'dry-run') return await delegate.count({ where })

    let deleted = 0
    for (let batch = 0; batch < HISTORY_PRUNE_MAX_BATCHES; batch++) {
      const rows = await delegate.findMany({ where, select: { id: true }, take: HISTORY_PRUNE_BATCH_SIZE })
      if (rows.length === 0) break
      const { count } = await delegate.deleteMany({ where: { id: { in: rows.map(row => row.id) } } })
      deleted += count
      if (rows.length < HISTORY_PRUNE_BATCH_SIZE) break
    }
    return deleted
  } catch (error) {
    log.error({ err: error, table, mode }, 'Failed to prune history table')
    return 0
  }
}

export async function pruneHistoryTables(
  { now = new Date(), env = process.env }: { now?: Date; env?: Record<string, string | undefined> } = {},
): Promise<HistoryPruneSummary> {
  const mode = historyPruneMode(env)
  const cutoffs = historyCutoffs(now)

  const summary: HistoryPruneSummary = {
    mode,
    taskEvents: await pruneTable(
      'TaskEvent',
      prisma.taskEvent as unknown as PrunableDelegate,
      taskEventPruneWhere(cutoffs.taskEvent),
      mode,
    ),
    analyticsEvents: await pruneTable(
      'AnalyticsEvent',
      prisma.analyticsEvent as unknown as PrunableDelegate,
      analyticsEventPruneWhere(cutoffs.analyticsEvent),
      mode,
    ),
    notifications: await pruneTable(
      'Notification',
      prisma.notification as unknown as PrunableDelegate,
      notificationPruneWhere(cutoffs.notificationRead, cutoffs.notification),
      mode,
    ),
  }

  log.info(
    { ...summary, cutoffs },
    mode === 'dry-run'
      ? 'History retention DRY RUN — counted, deleted nothing (set HISTORY_RETENTION_PRUNE=delete to prune)'
      : 'History retention pruned',
  )
  return summary
}
