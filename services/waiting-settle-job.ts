/**
 * The scheduled Waiting settle job, and its one-off backfill (Jon, 2026-11-12).
 *
 * The Waiting lane must leave by itself on every board, not only when a fixall loop sweeps (R3),
 * and a Ready task with a future date belongs in Waiting (R5). Every non-completed task in Waiting,
 * or in Ready with a future date, is put to astrid-core's `waitingSettle` (lib/waiting-rules.ts)
 * and the answer applied. The job never decides a lane itself.
 *
 * Two switches, both defaulting to `dry-run` — plan and report, write nothing
 * (lib/waiting-enforcement.ts):
 *
 * - `WAITING_SETTLE_MODE`: wake (`wakeToReady`) and park (`parkInWaiting`, unassigned).
 * - `WAITING_BACKFILL_MODE`: the one-off clean-up of data written before the rule —
 *   Waiting tasks that HAVE a condition but are assigned are unassigned (R2); Waiting tasks with
 *   NO condition at all (`resolveToInbox`) go to Inbox, keeping their assignee (R3).
 *
 * A condition-less Waiting task is the backfill's, not the settle's, while
 * `WAITING_ENFORCE_NATIVE=lenient`: a native app may still put one there (it has no picker), and
 * bouncing it to Inbox every few minutes would undo the user's drag in a loop. With `enforce`, the
 * settle resolves them too, as R3 says.
 *
 * The report names tasks (identifier and title) only on boards the reader owns; for everyone
 * else's it gives counts. It never carries an assignee.
 */
import { createLogger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { READY_STATUS_ROLE, WAITING_STATUS_ROLE } from '@/lib/task-status'
import { hasWaitCondition, waitingSettle, type SettleAction, type Settlement } from '@/lib/waiting-rules'
import { backfillModeFrom, nativeEnforcementFrom, settleModeFrom, type JobMode, type NativeEnforcement } from '@/lib/waiting-enforcement'
import { applySettlement } from '@/services/task-dependency.service'

const log = createLogger('services.waiting-settle-job')

/** Rows read per page, so a large table is walked rather than loaded. */
const PAGE = 500

export type BackfillAction = 'unassign' | 'toInbox'

export interface PlannedMove {
  taskId: string
  action: SettleAction | BackfillAction
  from: string | null
  to: string | null
  clearAssignee: boolean
  /** Set when the task is on a board the reader owns. */
  identifier?: string | null
  title?: string
}

export interface WaitingJobReport {
  now: string
  settleMode: JobMode
  backfillMode: JobMode
  nativeEnforcement: NativeEnforcement
  scanned: number
  settle: { counts: Partial<Record<SettleAction, number>>; heldForBackfill: number; applied: number }
  backfill: { counts: Record<BackfillAction, number>; applied: number }
  /** Moves on boards the reader owns, by name. Empty when no reader was given. */
  detail: PlannedMove[]
}

interface Candidate {
  id: string
  title: string
  identifier: string | null
  statusRole: string | null
  dueDateTime: Date | null
  isAllDay: boolean
  assigneeId: string | null
  completed: boolean
  blockedBy: Array<{ blockingTaskId: string; blockingTask: { completed: boolean } | null }>
}

/**
 * The plan for one task: what the settle and the backfill would each do. Pure, so the decision
 * table is tested without a database.
 */
export function planTask(
  task: Omit<Candidate, 'title' | 'identifier'>,
  now: Date,
  nativeEnforcement: NativeEnforcement,
): { settle?: { settlement: Settlement; heldForBackfill: boolean }; backfill?: BackfillAction } {
  const blockers = task.blockedBy.map(row => ({ id: row.blockingTaskId, completed: Boolean(row.blockingTask?.completed) }))
  const settlement = waitingSettle(task, blockers, now)
  const plan: ReturnType<typeof planTask> = {}

  if (settlement.action !== 'stay') {
    plan.settle = {
      settlement,
      heldForBackfill: settlement.action === 'resolveToInbox' && nativeEnforcement === 'lenient',
    }
  }
  if (!task.completed && task.statusRole === WAITING_STATUS_ROLE) {
    if (settlement.action === 'resolveToInbox') {
      plan.backfill = 'toInbox'
    } else if (
      settlement.action === 'stay' &&
      task.assigneeId &&
      hasWaitCondition(task.dueDateTime ? task.dueDateTime.getTime() : null, blockers, now)
    ) {
      plan.backfill = 'unassign'
    }
  }
  return plan
}

/**
 * Which of these tasks sit on a board (a list, or its project) the reader owns — asked of the
 * database, so the ownership rule is the query's and not restated here.
 */
async function ownedByReader(taskIds: string[], readerId: string | null): Promise<Set<string>> {
  if (!readerId || taskIds.length === 0) return new Set()
  const owned = await prisma.task.findMany({
    where: {
      id: { in: taskIds },
      lists: { some: { OR: [{ ownerId: readerId }, { project: { ownerId: readerId } }] } },
    },
    select: { id: true },
  })
  return new Set(owned.map(task => task.id))
}

/**
 * Run the job once. `readerId` is whose boards the report may name tasks on (the admin asking).
 * Modes default to the env switches; a caller may pass a stricter one (the report always dry-runs).
 */
export async function runWaitingSettleJob(args: {
  now?: Date
  settleMode?: JobMode
  backfillMode?: JobMode
  nativeEnforcement?: NativeEnforcement
  readerId?: string | null
} = {}): Promise<WaitingJobReport> {
  const now = args.now ?? new Date()
  const settleMode = args.settleMode ?? settleModeFrom()
  const backfillMode = args.backfillMode ?? backfillModeFrom()
  const nativeEnforcement = args.nativeEnforcement ?? nativeEnforcementFrom()
  const readerId = args.readerId ?? null

  const report: WaitingJobReport = {
    now: now.toISOString(),
    settleMode,
    backfillMode,
    nativeEnforcement,
    scanned: 0,
    settle: { counts: {}, heldForBackfill: 0, applied: 0 },
    backfill: { counts: { unassign: 0, toInbox: 0 }, applied: 0 },
    detail: [],
  }
  if (settleMode === 'off' && backfillMode === 'off') return report

  let cursor: string | undefined
  for (;;) {
    const page = (await prisma.task.findMany({
      where: {
        completed: false,
        OR: [
          { statusRole: WAITING_STATUS_ROLE },
          { statusRole: READY_STATUS_ROLE, dueDateTime: { gt: now } },
        ],
      },
      select: {
        id: true,
        title: true,
        identifier: true,
        statusRole: true,
        dueDateTime: true,
        isAllDay: true,
        assigneeId: true,
        completed: true,
        blockedBy: { select: { blockingTaskId: true, blockingTask: { select: { completed: true } } } },
      },
      orderBy: { id: 'asc' },
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    })) as Candidate[]
    if (page.length === 0) break
    cursor = page[page.length - 1].id
    const owned = await ownedByReader(page.map(task => task.id), readerId)

    for (const task of page) {
      report.scanned++
      const plan = planTask(task, now, nativeEnforcement)
      const named = owned.has(task.id) ? { identifier: task.identifier, title: task.title } : {}

      // The backfill first: it owns the condition-less tasks, and its unassign is a no-op for the settle.
      if (plan.backfill && backfillMode !== 'off') {
        report.backfill.counts[plan.backfill]++
        const move: PlannedMove = {
          taskId: task.id,
          action: plan.backfill,
          from: task.statusRole,
          to: plan.backfill === 'toInbox' ? null : WAITING_STATUS_ROLE,
          clearAssignee: plan.backfill === 'unassign',
        }
        if (named.title !== undefined) report.detail.push({ ...move, ...named })
        if (backfillMode === 'apply') {
          if (await applyPlanned(move, task.assigneeId)) report.backfill.applied++
          continue
        }
      }

      if (plan.settle && settleMode !== 'off') {
        const { settlement, heldForBackfill } = plan.settle
        if (heldForBackfill) {
          report.settle.heldForBackfill++
          continue
        }
        report.settle.counts[settlement.action] = (report.settle.counts[settlement.action] ?? 0) + 1
        const move: PlannedMove = {
          taskId: task.id,
          action: settlement.action,
          from: task.statusRole,
          to: settlement.statusRole,
          clearAssignee: settlement.assignee === 'clear',
        }
        if (named.title !== undefined) report.detail.push({ ...move, ...named })
        if (settleMode === 'apply' && (await applyPlanned(move, task.assigneeId))) report.settle.applied++
      }
    }
    if (page.length < PAGE) break
  }

  log.info(
    {
      settleMode,
      backfillMode,
      nativeEnforcement,
      scanned: report.scanned,
      settle: report.settle,
      backfill: report.backfill,
    },
    settleMode === 'apply' || backfillMode === 'apply' ? 'waiting settle: applied' : 'waiting settle: planned (dry run)',
  )
  return report
}

async function applyPlanned(move: PlannedMove, formerAssigneeId: string | null): Promise<boolean> {
  try {
    return await applySettlement({
      taskId: move.taskId,
      from: move.from,
      to: move.to,
      clearAssignee: move.clearAssignee,
      formerAssigneeId,
      kind: move.action === 'wakeToReady' ? 'unblocked' : 'status_changed',
    })
  } catch (err) {
    log.error({ err, taskId: move.taskId, action: move.action }, 'waiting settle: a move failed')
    return false
  }
}
