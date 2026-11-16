/**
 * Expired agent claim leases (AWTD-1688, docs/AGENT_CLAIM_API.md).
 *
 * A claim through POST /api/v1/tasks/:id/claim carries a lease its holder
 * renews with `heartbeat`. When a run dies the heartbeats stop, the lease runs
 * out, and this returns the task to Ready with a comment saying why. It replaces,
 * for leased claims, what the repo-local stale-Doing sweep
 * (scripts/release-stuck-doing.ts) guessed from idleness.
 *
 * Runs on the existing five-minute waiting-settle cron (vercel.json); no
 * scheduler of its own. The rules are `decideExpiredLease` in
 * lib/agent-task-claim.ts; this is the I/O.
 */
import { prisma } from '@/lib/prisma'
import { DOING_STATUS_ROLE, READY_STATUS_ROLE } from '@/lib/task-status'
import { decideExpiredLease, expiredLeaseComment } from '@/lib/agent-task-claim'

/** One cron tick's ceiling; the rest wait five minutes for the next. */
const EXPIRED_LEASE_BATCH = 200

export interface ExpiredLeaseReport {
  scanned: number
  /** Back to Ready, with a comment. */
  released: number
  /** The task had moved on; only the lease was cleared. */
  cleared: number
}

export async function expireAgentClaimLeases(options: { now?: Date; limit?: number } = {}): Promise<ExpiredLeaseReport> {
  const now = options.now ?? new Date()
  const due = await prisma.task.findMany({
    where: { claimLeaseExpiresAt: { lte: now } },
    orderBy: { claimLeaseExpiresAt: 'asc' },
    take: options.limit ?? EXPIRED_LEASE_BATCH,
    select: {
      id: true,
      statusRole: true,
      completed: true,
      assigneeId: true,
      assigneeIds: true,
      updatedAt: true,
      claimLeaseExpiresAt: true,
      claimHeartbeatAt: true,
      claimHolderId: true,
      lists: { select: { agentClaimRequired: true } },
    },
  })

  const report: ExpiredLeaseReport = { scanned: due.length, released: 0, cleared: 0 }
  const noLease = { claimLeaseExpiresAt: null, claimHeartbeatAt: null, claimHolderId: null }

  for (const task of due) {
    const expiredAt = task.claimLeaseExpiresAt
    if (!expiredAt) continue
    const decision = decideExpiredLease({
      ...task,
      enrolled: task.lists.some(list => list.agentClaimRequired),
    })
    // Every write is conditional on the lease being the one read: a heartbeat
    // that lands between the read and the write renews it, and wins.
    if (decision.kind === 'clear') {
      const cleared = await prisma.task.updateMany({
        where: { id: task.id, claimLeaseExpiresAt: expiredAt },
        // Not an edit of the task: its updatedAt stays.
        data: { ...noLease, updatedAt: task.updatedAt },
      })
      report.cleared += cleared.count
      continue
    }

    const released = await prisma.$transaction(async tx => {
      const moved = await tx.task.updateMany({
        where: {
          id: task.id,
          completed: false,
          statusRole: DOING_STATUS_ROLE,
          assigneeId: task.claimHolderId,
          claimLeaseExpiresAt: expiredAt,
        },
        data: {
          statusRole: READY_STATUS_ROLE,
          assigneeId: decision.assigneeId,
          assigneeIds: decision.assigneeIds,
          ...noLease,
        },
      })
      if (moved.count !== 1) return false
      await tx.comment.create({
        data: { taskId: task.id, authorId: null, content: expiredLeaseComment(task.claimHeartbeatAt, expiredAt) },
      })
      return true
    })
    if (released) report.released += 1
  }

  return report
}
