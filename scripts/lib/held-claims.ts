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

/**
 * The line a heartbeat tick prints when it renews nothing (ADEV-310). For its whole life
 * the heartbeat was a silent no-op: the board read dropped the claim fields, so nothing
 * ever matched and nothing was printed. "N doing, 0 mine" while this agent holds a claim
 * is that failure, visible in the run log.
 */
export function nothingToRenewLine(tasks: HeldClaimTask[], agentId: string): string {
  const doing = tasks.filter(task => (task.statusRole ?? '').toLowerCase() === 'doing')
  const mine = doing.filter(task => task.claimHolderId === agentId)
  return `HEARTBEAT: nothing to renew (${doing.length} doing, ${mine.length} mine)`
}
