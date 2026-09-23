/**
 * WebVitalSample retention (AWTD-990).
 *
 * `components/web-vitals-reporter.tsx` sends a sample per page view with no
 * sampling, `getWebVitalsReport` reads only the last 28 days, and nothing ever
 * deleted the rest — so the table grew forever, and every future migration of
 * it (the AWTD-984 route scrub was one) seq-scans history nobody reads.
 *
 * The dangerous half of a retention delete is the one these tests are mostly
 * about: retention SHORTER than the report window silently truncates the
 * report. The oldest days come back half-empty, the p75 shifts, and nothing
 * anywhere says why. So the window and the retention period are one pair of
 * constants with an asserted ordering, not two numbers that happen to agree.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

const deleteMany = vi.fn()
vi.mock('@/lib/prisma', () => ({ prisma: { webVitalSample: { deleteMany: (...a: unknown[]) => deleteMany(...a) } } }))

const { pruneWebVitalSamples } = await import('@/lib/web-vitals-service')
const { WEB_VITALS_RETENTION_DAYS, WEB_VITALS_WINDOW_DAYS } = await import('@/lib/web-vitals')

const DAY_MS = 24 * 60 * 60 * 1000

describe('web vitals retention (AWTD-990)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    deleteMany.mockResolvedValue({ count: 0 })
  })

  it('never keeps LESS history than the report reads', () => {
    // The invariant. If this ever inverts, getWebVitalsReport starts reporting
    // a p75 over a window it no longer has the data for.
    expect(WEB_VITALS_RETENTION_DAYS).toBeGreaterThanOrEqual(WEB_VITALS_WINDOW_DAYS)
  })

  it('deletes only samples older than the retention period', async () => {
    const now = new Date('2026-09-22T08:00:00Z')

    await pruneWebVitalSamples({ now })

    expect(deleteMany).toHaveBeenCalledTimes(1)
    const where = deleteMany.mock.calls[0][0].where
    expect(where.createdAt.lt).toEqual(
      new Date(now.getTime() - WEB_VITALS_RETENTION_DAYS * DAY_MS),
    )
  })

  it('leaves every sample the report would still read', async () => {
    const now = new Date('2026-09-22T08:00:00Z')

    await pruneWebVitalSamples({ now })

    const cutoff: Date = deleteMany.mock.calls[0][0].where.createdAt.lt
    const oldestReported = new Date(now.getTime() - WEB_VITALS_WINDOW_DAYS * DAY_MS)

    // Strictly older, not merely equal: a sample at the exact edge of the
    // report window must survive a prune that runs moments before the report.
    expect(cutoff.getTime()).toBeLessThan(oldestReported.getTime())
  })

  it('reports how many rows it removed', async () => {
    deleteMany.mockResolvedValue({ count: 417 })

    expect(await pruneWebVitalSamples({ now: new Date() })).toBe(417)
  })

  it('returns 0 instead of throwing when the delete fails', async () => {
    // Sits beside recordWebVitalSample, which declines rather than throws for
    // the same reason: telemetry must never produce something that reads as a
    // real incident. Here it would fail the whole nightly analytics cron.
    deleteMany.mockRejectedValue(new Error('connection terminated'))

    await expect(pruneWebVitalSamples({ now: new Date() })).resolves.toBe(0)
  })
})
