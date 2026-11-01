/**
 * Retention for the three append-only history tables (AWTD-1455).
 *
 * `TaskEvent` gets a row per task mutation, `AnalyticsEvent` a row per user
 * action, `Notification` a row per fan-out recipient — and nothing expired any
 * of them, so they grew without bound (finding W7 in
 * docs/architecture/PLATFORM_ASSESSMENT_2026-11.md). Same shape as
 * WebVitalSample (AWTD-990) and DeletionLog (AWTD-993): a window per table,
 * pruned by the nightly `/api/cron/analytics`.
 *
 * Pure — no database — so the windows and their ordering against the readers
 * are testable without one. The Prisma half is lib/history-retention-service.ts.
 *
 * EVERY WINDOW IS SET BY ITS READERS, and the test pins the ordering, because
 * retention shorter than a window someone reads fails silently: the oldest end
 * of a chart comes back empty and nothing raises.
 *
 * OFF BY DEFAULT. Deleting history is destructive and the first run after a
 * deploy would remove everything older than each window at once. Unless
 * `HISTORY_RETENTION_PRUNE=delete` is set, the cron only COUNTS what it would
 * delete and logs that count, so the first prune is sized before anyone turns
 * it on.
 */

import { LANE_MOVE_KINDS, INSIGHT_WINDOW_DAYS } from './list-insights'
import { CACHE_METRICS_MAX_REPORT_DAYS } from './cache-metrics'

/**
 * TaskEvent: one year.
 *
 * Its only reader is list insights (services/list-insights.service.ts), whose
 * widest window is 90 days (INSIGHT_WINDOW_DAYS) — so a year is a 4x margin.
 * The exception is lane history, below.
 */
export const TASK_EVENT_RETENTION_DAYS = 365

/**
 * TaskEvent kinds that are NEVER pruned.
 *
 * Lane durations time a stay that ENDS in the window from the move that OPENED
 * it, which can be arbitrarily old — the insights query reads these kinds with
 * no date bound on purpose (AWTD-1367). A birth lane is inferred from the full
 * history since LANE_HISTORY_START, including completion and reopen. Pruning
 * any of these by age would silently shorten or drop real lane stays. They are
 * a small fraction of all events (98 lane rows repo-wide at AWTD-1367).
 */
export const TASK_EVENT_KEPT_KINDS: readonly string[] = [
  ...LANE_MOVE_KINDS,
  'completed',
  'closed',
  'reopened',
]

/**
 * AnalyticsEvent: 120 days.
 *
 * The daily rollup (AnalyticsDailyStats) is written from the raw rows the night
 * after, and MAU reads the trailing 30 days. The widest raw reader is
 * `/admin/analytics`' per-platform event counts (getEventCountsByPlatform),
 * whose range selector tops out at 90 days (CACHE_METRICS_MAX_REPORT_DAYS) —
 * so retention is that plus a month, which also leaves room to re-run
 * scripts/backfill-analytics.ts over a recent bad aggregation.
 */
export const ANALYTICS_EVENT_RETENTION_DAYS = CACHE_METRICS_MAX_REPORT_DAYS + 30

/**
 * Notification: a READ notification goes 90 days after it was read; ANY
 * notification goes 180 days after it was created.
 *
 * The reader is the inbox (GET /api/v1/notifications), newest first, plus the
 * unread count. An unread notification half a year old is not news any more,
 * and leaving it would keep the badge lit forever.
 */
export const NOTIFICATION_READ_RETENTION_DAYS = 90
export const NOTIFICATION_RETENTION_DAYS = 180

/** Widest window anything reads raw TaskEvents over (by date). */
export const TASK_EVENT_MAX_READ_DAYS = Math.max(...INSIGHT_WINDOW_DAYS)

/** Rows per DELETE. Small enough that no single statement holds locks for long. */
export const HISTORY_PRUNE_BATCH_SIZE = 5_000

/**
 * Batches per table per run. The first enabled run may face a long backlog;
 * capping it keeps the nightly cron inside its time limit and lets the backlog
 * drain over several nights instead of in one long transaction storm.
 */
export const HISTORY_PRUNE_MAX_BATCHES = 20

/** The switch. Exactly `delete` deletes; anything else (unset included) counts only. */
export const HISTORY_RETENTION_PRUNE_ENV = 'HISTORY_RETENTION_PRUNE'

export type HistoryPruneMode = 'delete' | 'dry-run'

export function historyPruneMode(env: Record<string, string | undefined> = process.env): HistoryPruneMode {
  return env[HISTORY_RETENTION_PRUNE_ENV] === 'delete' ? 'delete' : 'dry-run'
}

const DAY_MS = 24 * 60 * 60 * 1000

export interface HistoryCutoffs {
  taskEvent: Date
  analyticsEvent: Date
  notificationRead: Date
  notification: Date
}

export function historyCutoffs(now: Date): HistoryCutoffs {
  const ago = (days: number) => new Date(now.getTime() - days * DAY_MS)
  return {
    taskEvent: ago(TASK_EVENT_RETENTION_DAYS),
    analyticsEvent: ago(ANALYTICS_EVENT_RETENTION_DAYS),
    notificationRead: ago(NOTIFICATION_READ_RETENTION_DAYS),
    notification: ago(NOTIFICATION_RETENTION_DAYS),
  }
}
