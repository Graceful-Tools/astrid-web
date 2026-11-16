/**
 * GET /api/cron/waiting-settle — the scheduled Waiting settle job (Jon, 2026-11-12).
 *
 * Every five minutes (vercel.json). Wakes Waiting tasks whose condition is gone, parks dated Ready
 * tasks in Waiting, and runs the one-off backfill — each through astrid-core's `waitingSettle`,
 * each behind its own mode switch (WAITING_SETTLE_MODE, WAITING_BACKFILL_MODE), both `dry-run`
 * by default: the run is logged and summarised, nothing is written. services/waiting-settle-job.ts
 * has the rules; the dry-run report with task names is GET /api/admin/waiting-report.
 *
 * Also expires agent claim leases (AWTD-1688, services/agent-claim-lease.service.ts): a claim
 * whose holder stopped heartbeating goes back to Ready. That part has no mode switch — only claims
 * made through the leased route carry a lease, so nothing older is touched.
 *
 * Same secret as every cron route; fails closed without it.
 */
import { NextRequest } from 'next/server'
import { requireCronSecret } from '@/lib/cron-auth'
import { runCronJob } from '@/lib/cron-observability'
import { runWaitingSettleJob } from '@/services/waiting-settle-job'
import { expireAgentClaimLeases } from '@/services/agent-claim-lease.service'
import { createLogger } from '@/lib/logger'

const log = createLogger('cron')

export const maxDuration = 60

export async function GET(request: NextRequest) {
  const blocked = requireCronSecret(request)
  if (blocked) return blocked

  return runCronJob('waiting-settle', async () => {
    // Counts only: the cron summary is logged, and it names no task.
    // The lease sweep runs whatever the settle job does, and its failure never fails the settle.
    const [settled, expired] = await Promise.allSettled([runWaitingSettleJob(), expireAgentClaimLeases()])
    if (settled.status === 'rejected') throw settled.reason
    const report = settled.value
    const leases = expired.status === 'fulfilled' ? expired.value : { scanned: -1, released: 0, cleared: 0 }
    if (expired.status === 'rejected') log.error({ err: expired.reason }, 'claim lease expiry FAILED')
    return {
      settleMode: report.settleMode,
      backfillMode: report.backfillMode,
      nativeEnforcement: report.nativeEnforcement,
      scanned: report.scanned,
      settleWake: report.settle.counts.wakeToReady ?? 0,
      settlePark: report.settle.counts.parkInWaiting ?? 0,
      settleInbox: report.settle.counts.resolveToInbox ?? 0,
      settleHeldForBackfill: report.settle.heldForBackfill,
      settleApplied: report.settle.applied,
      backfillUnassign: report.backfill.counts.unassign,
      backfillToInbox: report.backfill.counts.toInbox,
      backfillToDoing: report.backfill.counts.toDoing,
      backfillApplied: report.backfill.applied,
      leasesExpired: leases.scanned,
      leasesReleased: leases.released,
      leasesCleared: leases.cleared,
    }
  })
}
