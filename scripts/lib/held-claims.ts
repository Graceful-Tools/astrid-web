/**
 * Which claim leases a cloud run renews (ADEV-37).
 *
 * MCP `claim_task` holds a 15-minute lease its holder renews with `heartbeat`
 * (AWTD-1688). Nothing in a cloud run renewed it, so on 2026-11-16 ADEV-22 went
 * back to Ready three times mid-run and two runs built the same change.
 *
 * A run renews a Doing task held by its agent only when that lease was taken or
 * renewed since the run started. A claim older than the run belongs to a session
 * that may be dead; renewing it from every run would keep one stray lease alive
 * for as long as runs keep coming, and the stale sweep skips live leases.
 */
export interface HeldClaimTask {
  id: string
  statusRole?: string | null
  claimHolderId?: string | null
  claimLeaseExpiresAt?: string | null
  claimHeartbeatAt?: string | null
}

export function claimsToRenew(
  tasks: HeldClaimTask[],
  opts: { agentId: string; runStartedAt: Date; now: Date },
): string[] {
  return tasks
    .filter(task => (task.statusRole ?? '').toLowerCase() === 'doing')
    .filter(task => task.claimHolderId === opts.agentId)
    .filter(task => task.claimLeaseExpiresAt && new Date(task.claimLeaseExpiresAt).getTime() > opts.now.getTime())
    .filter(task => task.claimHeartbeatAt && new Date(task.claimHeartbeatAt).getTime() >= opts.runStartedAt.getTime())
    .map(task => task.id)
}
