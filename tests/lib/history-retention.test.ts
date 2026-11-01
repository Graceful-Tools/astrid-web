/**
 * AWTD-1455 — retention windows for TaskEvent, AnalyticsEvent and Notification,
 * and the switch that keeps the first production run from deleting anything.
 *
 * Each window is pinned, AND pinned against the widest window its readers ask
 * for: retention shorter than a read window is the failure that never
 * announces itself (see WEB_VITALS_RETENTION_DAYS, CACHE_METRICS_RETENTION_DAYS).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const taskEvent = { count: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() }
const analyticsEvent = { count: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() }
const notification = { count: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() }

vi.mock('@/lib/prisma', () => ({ prisma: { taskEvent, analyticsEvent, notification } }))

const retention = await import('@/lib/history-retention')
const service = await import('@/lib/history-retention-service')
const { LANE_MOVE_KINDS, INSIGHT_WINDOW_DAYS } = await import('@/lib/list-insights')
const { CACHE_METRICS_MAX_REPORT_DAYS } = await import('@/lib/cache-metrics')

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = new Date('2026-11-01T08:00:00Z')

describe('history retention windows (AWTD-1455)', () => {
  it('pins each window', () => {
    expect(retention.TASK_EVENT_RETENTION_DAYS).toBe(365)
    expect(retention.ANALYTICS_EVENT_RETENTION_DAYS).toBe(120)
    expect(retention.NOTIFICATION_READ_RETENTION_DAYS).toBe(90)
    expect(retention.NOTIFICATION_RETENTION_DAYS).toBe(180)
  })

  it('keeps TaskEvents far longer than the widest insights window', () => {
    expect(retention.TASK_EVENT_RETENTION_DAYS).toBeGreaterThanOrEqual(2 * Math.max(...INSIGHT_WINDOW_DAYS))
  })

  it('never prunes the lane-history kinds insights read with no date bound', () => {
    for (const kind of LANE_MOVE_KINDS) expect(retention.TASK_EVENT_KEPT_KINDS).toContain(kind)
    for (const kind of ['completed', 'closed', 'reopened']) expect(retention.TASK_EVENT_KEPT_KINDS).toContain(kind)
    expect(service.taskEventPruneWhere(NOW)).toEqual({
      createdAt: { lt: NOW },
      kind: { notIn: [...retention.TASK_EVENT_KEPT_KINDS] },
    })
  })

  it('keeps AnalyticsEvents longer than /admin/analytics can ask for', () => {
    expect(retention.ANALYTICS_EVENT_RETENTION_DAYS).toBeGreaterThanOrEqual(CACHE_METRICS_MAX_REPORT_DAYS + 7)
  })

  it('expires a read notification sooner than an unread one', () => {
    expect(retention.NOTIFICATION_READ_RETENTION_DAYS).toBeLessThan(retention.NOTIFICATION_RETENTION_DAYS)
    const cutoffs = retention.historyCutoffs(NOW)
    expect(NOW.getTime() - cutoffs.notificationRead.getTime()).toBe(90 * DAY_MS)
    expect(NOW.getTime() - cutoffs.notification.getTime()).toBe(180 * DAY_MS)
    expect(NOW.getTime() - cutoffs.taskEvent.getTime()).toBe(365 * DAY_MS)
    expect(NOW.getTime() - cutoffs.analyticsEvent.getTime()).toBe(120 * DAY_MS)
  })
})

describe('the prune switch defaults OFF (AWTD-1455)', () => {
  it.each([[undefined], [''], ['true'], ['1'], ['on'], ['DELETE']])('%s → dry-run', value => {
    expect(retention.historyPruneMode({ HISTORY_RETENTION_PRUNE: value })).toBe('dry-run')
  })

  it('only the exact value "delete" deletes', () => {
    expect(retention.historyPruneMode({ HISTORY_RETENTION_PRUNE: 'delete' })).toBe('delete')
  })
})

describe('pruneHistoryTables (AWTD-1455)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const table of [taskEvent, analyticsEvent, notification]) {
      table.count.mockResolvedValue(0)
      table.findMany.mockResolvedValue([])
      table.deleteMany.mockResolvedValue({ count: 0 })
    }
  })

  it('in dry-run, counts what each window would remove and deletes NOTHING', async () => {
    taskEvent.count.mockResolvedValue(11)
    analyticsEvent.count.mockResolvedValue(22)
    notification.count.mockResolvedValue(33)

    const summary = await service.pruneHistoryTables({ now: NOW, env: {} })

    expect(summary).toEqual({ mode: 'dry-run', taskEvents: 11, analyticsEvents: 22, notifications: 33 })
    for (const table of [taskEvent, analyticsEvent, notification]) {
      expect(table.deleteMany).not.toHaveBeenCalled()
      expect(table.findMany).not.toHaveBeenCalled()
    }
    const cutoffs = retention.historyCutoffs(NOW)
    expect(notification.count).toHaveBeenCalledWith({
      where: { OR: [{ readAt: { lt: cutoffs.notificationRead } }, { createdAt: { lt: cutoffs.notification } }] },
    })
    expect(analyticsEvent.count).toHaveBeenCalledWith({ where: { createdAt: { lt: cutoffs.analyticsEvent } } })
  })

  it('when switched on, deletes in id batches and stops at the per-run cap', async () => {
    const fullBatch = Array.from({ length: retention.HISTORY_PRUNE_BATCH_SIZE }, (_, i) => ({ id: `e${i}` }))
    analyticsEvent.findMany.mockResolvedValue(fullBatch)
    analyticsEvent.deleteMany.mockResolvedValue({ count: fullBatch.length })

    const summary = await service.pruneHistoryTables({ now: NOW, env: { HISTORY_RETENTION_PRUNE: 'delete' } })

    expect(summary.mode).toBe('delete')
    expect(analyticsEvent.deleteMany).toHaveBeenCalledTimes(retention.HISTORY_PRUNE_MAX_BATCHES)
    expect(summary.analyticsEvents).toBe(retention.HISTORY_PRUNE_MAX_BATCHES * retention.HISTORY_PRUNE_BATCH_SIZE)
    expect(analyticsEvent.deleteMany.mock.calls[0][0]).toEqual({ where: { id: { in: fullBatch.map(r => r.id) } } })
    expect(analyticsEvent.count).not.toHaveBeenCalled()
  })

  it('stops after a short batch', async () => {
    taskEvent.findMany.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }])
    taskEvent.deleteMany.mockResolvedValueOnce({ count: 2 })

    const summary = await service.pruneHistoryTables({ now: NOW, env: { HISTORY_RETENTION_PRUNE: 'delete' } })

    expect(taskEvent.deleteMany).toHaveBeenCalledTimes(1)
    expect(summary.taskEvents).toBe(2)
  })

  it('a failing table reads as zero and does not stop the others', async () => {
    taskEvent.count.mockRejectedValue(new Error('boom'))
    notification.count.mockResolvedValue(5)

    const summary = await service.pruneHistoryTables({ now: NOW, env: {} })

    expect(summary.taskEvents).toBe(0)
    expect(summary.notifications).toBe(5)
  })
})
