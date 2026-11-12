/**
 * The Waiting rules on the server's task writes (Jon, 2026-11-12).
 *
 * Every write that can change a task's `statusRole`, `dueDateTime` or blockers — the update and
 * create verbs in services/task.service.ts, which every surface (v1, the agent PATCH, the legacy
 * create, MCP over both transports, invitations) funnels through — asks
 * lib/waiting-rules.ts `waitingWrite` here. The decision is astrid-core's (R1/R2); this module only
 * gathers its inputs and turns its answer into columns:
 *
 * - **Refused** (`WAITING_NEEDS_CONDITION`): a 422 with a sentence a person can act on, because old
 *   native clients show `error` verbatim. Except, while `WAITING_ENFORCE_NATIVE=lenient`, a move
 *   from a native app, which has no picker yet: let through, logged, counted (lib/waiting-enforcement.ts).
 * - **`assignee: "clear"`**: the assignee is cleared in the same write.
 * - **`transition` other than `none`**: the role the rules say (Waiting, Ready on a wake, Inbox for
 *   legacy data) replaces the one asked for.
 *
 * `keepAssignee` and `waitOnTaskId` are the two request fields this adds. `waitOnTaskId` is checked
 * here (read access, cycles) and attached by the caller after its row is written
 * (services/task-dependency.service.ts `attachBlocker`).
 */
import type { AnalyticsPlatformValue } from '@/lib/analytics-events'
import { createLogger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import {
  waitingWrite,
  WAITING_NEEDS_CONDITION,
  WAITING_ROLE,
  type WaitingBlocker,
  type WaitingChange,
  type WaitingTransition,
} from '@/lib/waiting-rules'
import {
  countNativeLenient,
  countRefused,
  letsNativeThrough,
  WAITING_NEEDS_CONDITION_USER_MESSAGE,
} from '@/lib/waiting-enforcement'
import { resolveTaskIdOrIdentifier } from '@/lib/task-identifier'
import { checkBlockerCandidate } from '@/services/task-dependency.service'

const log = createLogger('services.task-waiting')

export type WaitingRefusal =
  | { ok: false; status: 422; error: string; code: typeof WAITING_NEEDS_CONDITION }
  | { ok: false; status: 403 | 404 | 409; error: string; code?: string }

export interface WaitingDecision {
  ok: true
  /** Columns to merge into the write: `statusRole`, and `assigneeId`/`assigneeIds` when cleared. */
  data: Record<string, unknown>
  /** A blocker to attach once the row is written (`waitOnTaskId`). */
  attachBlockerId?: string
  transition: WaitingTransition | 'native-lenient'
}

/** The request fields the Waiting rules add to an update or a create. */
export interface WaitingRequest {
  keepAssignee?: boolean
  waitOnTaskId?: string | null
}

/** A task's blockers, each with its completion — the rules' `blockers`. */
export async function loadWaitingBlockers(taskId: string): Promise<WaitingBlocker[]> {
  const rows = await prisma.taskDependency.findMany({
    where: { blockedTaskId: taskId },
    select: { blockingTaskId: true, blockingTask: { select: { completed: true } } },
  })
  return rows.map(row => ({ id: row.blockingTaskId, completed: Boolean(row.blockingTask?.completed) }))
}

function time(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : new Date(value as string)
  return Number.isNaN(date.getTime()) ? null : date.getTime()
}

const sameRole = (a: unknown, b: unknown) => ((a as string | null | undefined) ?? null) === ((b as string | null | undefined) ?? null)

function refusalFor(args: { platform?: AnalyticsPlatformValue; surface: string }): WaitingRefusal | null {
  if (letsNativeThrough(args.platform)) {
    countNativeLenient(args.platform as string)
    log.warn(
      { platform: args.platform, surface: args.surface, rule: 'R2', code: WAITING_NEEDS_CONDITION },
      'waiting: a native app moved a task into Waiting with no condition; let through (WAITING_ENFORCE_NATIVE=lenient)',
    )
    return null
  }
  countRefused()
  return { ok: false, status: 422, error: WAITING_NEEDS_CONDITION_USER_MESSAGE, code: WAITING_NEEDS_CONDITION }
}

async function blockerToAdd(args: {
  taskId: string | null
  waitOnTaskId: string | null | undefined
  actorId: string
}): Promise<{ ok: true; blocker?: WaitingBlocker } | WaitingRefusal> {
  const { taskId, waitOnTaskId, actorId } = args
  if (!waitOnTaskId) return { ok: true }
  // An identifier (AWTD-1007) is accepted wherever a task id is, as on the blocker routes.
  const blockingTaskId = await resolveTaskIdOrIdentifier(waitOnTaskId.trim())
  if (!blockingTaskId) return { ok: false, status: 404, error: 'Blocking task not found' }
  const checked = await checkBlockerCandidate({ taskId, blockingTaskId, userId: actorId })
  if (!checked.ok) return { ok: false, status: checked.status, error: checked.error, code: 'reason' in checked ? checked.reason : undefined }
  return { ok: true, blocker: { id: blockingTaskId, completed: checked.completed } }
}

function columnsFor(statusRole: string | null, clear: boolean): Record<string, unknown> {
  const data: Record<string, unknown> = { statusRole }
  if (clear) {
    data.assigneeId = null
    data.assigneeIds = []
  }
  return data
}

/**
 * The Waiting rules on an update. `data` is the write as built so far (after the role, date and
 * assignee have been decided); `requestedCompleted` the completion it asks for.
 */
export async function resolveWaitingForUpdate(args: {
  existingTask: {
    id: string
    statusRole?: string | null
    dueDateTime?: Date | string | null
    isAllDay?: boolean | null
    assigneeId?: string | null
    completed?: boolean | null
  }
  data: Record<string, unknown>
  requestedCompleted: boolean | undefined
  request: WaitingRequest
  actorId: string
  platform?: AnalyticsPlatformValue
  surface?: string
  now?: Date
}): Promise<WaitingDecision | WaitingRefusal> {
  const { existingTask, data, requestedCompleted, request, actorId, platform, surface = 'update', now = new Date() } = args

  const added = await blockerToAdd({ taskId: existingTask.id, waitOnTaskId: request.waitOnTaskId, actorId })
  if (!added.ok) return added
  const attachBlockerId = added.blocker?.id

  // Done owns the lane (services/task-completion.ts): nothing to decide for a finished task.
  const completedAfter = requestedCompleted ?? Boolean(existingTask.completed)
  if (completedAfter) return { ok: true, data: {}, attachBlockerId, transition: 'none' }

  // Only what actually changes. The web sends the whole task back on every edit, so a title edit
  // carries the same role and date it read; that is not a move.
  const change: WaitingChange = {}
  if (Object.hasOwn(data, 'statusRole') && !sameRole(data.statusRole, existingTask.statusRole)) {
    change.statusRole = (data.statusRole as string | null) ?? null
  }
  // A reopen restores a lane through the completion fields; that is a move too.
  if (existingTask.completed && Object.hasOwn(data, 'statusRole')) change.statusRole = (data.statusRole as string | null) ?? null
  if (Object.hasOwn(data, 'dueDateTime') && time(data.dueDateTime) !== time(existingTask.dueDateTime)) {
    change.dueDateTime = (data.dueDateTime as Date | null) ?? null
  }
  if (added.blocker) change.addBlockers = [added.blocker]
  if (!Object.hasOwn(change, 'statusRole') && !Object.hasOwn(change, 'dueDateTime') && !change.addBlockers) {
    return { ok: true, data: {}, attachBlockerId, transition: 'none' }
  }
  // Neither in Waiting nor moving into it: the rules answer `none` whatever the date or blockers,
  // so they are not asked (and the blockers not read) — the common edit costs nothing.
  // Likewise a move OUT of Waiting (to any other lane): the rules answer `none`.
  const wasWaiting = !existingTask.completed && existingTask.statusRole === WAITING_ROLE
  const movesElsewhere = Object.hasOwn(change, 'statusRole') && change.statusRole !== WAITING_ROLE
  if (movesElsewhere || (!wasWaiting && change.statusRole !== WAITING_ROLE)) {
    return { ok: true, data: {}, attachBlockerId, transition: 'none' }
  }
  if (request.keepAssignee) change.keepAssignee = true

  // The assignee the write leaves, so a write that assigns AND enters Waiting clears the new one.
  const assigneeAfter = Object.hasOwn(data, 'assigneeId') ? ((data.assigneeId as string | null) ?? null) : (existingTask.assigneeId ?? null)
  const task = {
    id: existingTask.id,
    statusRole: existingTask.completed ? null : (existingTask.statusRole ?? null),
    dueDateTime: existingTask.dueDateTime ?? null,
    isAllDay: existingTask.isAllDay ?? false,
    assigneeId: assigneeAfter,
    completed: false,
  }
  const answer = waitingWrite(task, await loadWaitingBlockers(existingTask.id), change, now)
  if (!answer.ok) {
    // Unticking a finished task restores the lane it was in. One that was Waiting with nothing to
    // wait on any more reopens into Inbox rather than refusing the reopen.
    if (existingTask.completed && requestedCompleted === false) {
      return { ok: true, data: { statusRole: null }, attachBlockerId, transition: 'inbox' }
    }
    const refused = refusalFor({ platform, surface })
    if (refused) return refused
    return { ok: true, data: columnsFor(WAITING_ROLE, !request.keepAssignee && Boolean(assigneeAfter)), attachBlockerId, transition: 'native-lenient' }
  }
  const { value } = answer
  if (value.transition === 'none') return { ok: true, data: {}, attachBlockerId, transition: 'none' }
  return { ok: true, data: columnsFor(value.statusRole, value.assignee === 'clear'), attachBlockerId, transition: value.transition }
}

/** The Waiting rules on a create: only a task born in Waiting is their business. */
export async function resolveWaitingForCreate(args: {
  statusRole: string | null | undefined
  dueDateTime: Date | null
  assigneeId: string | null
  completed: boolean
  request: WaitingRequest
  actorId: string
  platform?: AnalyticsPlatformValue
  surface?: string
  now?: Date
}): Promise<WaitingDecision | WaitingRefusal> {
  const { statusRole, dueDateTime, assigneeId, completed, request, actorId, platform, surface = 'create', now = new Date() } = args

  const added = await blockerToAdd({ taskId: null, waitOnTaskId: request.waitOnTaskId, actorId })
  if (!added.ok) return added
  const attachBlockerId = added.blocker?.id

  const role = typeof statusRole === 'string' ? statusRole.trim().toLowerCase() : null
  if (completed || role !== WAITING_ROLE) return { ok: true, data: {}, attachBlockerId, transition: 'none' }

  const change: WaitingChange = { statusRole: WAITING_ROLE }
  if (dueDateTime) change.dueDateTime = dueDateTime
  if (added.blocker) change.addBlockers = [added.blocker]
  if (request.keepAssignee) change.keepAssignee = true

  const answer = waitingWrite({ id: '', statusRole: null, assigneeId }, [], change, now)
  if (!answer.ok) {
    const refused = refusalFor({ platform, surface })
    if (refused) return refused
    return { ok: true, data: columnsFor(WAITING_ROLE, !request.keepAssignee && Boolean(assigneeId)), attachBlockerId, transition: 'native-lenient' }
  }
  return { ok: true, data: columnsFor(answer.value.statusRole, answer.value.assignee === 'clear'), attachBlockerId, transition: answer.value.transition }
}
