/**
 * Handoff as a command (AWTD-1686): file the other half of a task on another list, and get the
 * task back when that half is done.
 *
 * Before this, handing work to another board was a convention — a create on the other list, maybe
 * a blocker, maybe not — and adding a blocker unassigns the source (Waiting rule R2), so when the
 * other half completed the source woke to Ready with nobody on it. The agent that started the work
 * lost it unless its queue happened to read unassigned tasks.
 *
 * WHAT a handoff writes is astrid-core's Waiting rule R8 (`waitingHandoff`, lib/waiting-rules.ts):
 * the half is born in Ready; the source enters Waiting on it, unassigned as any entry is, and the
 * plan names who held it. This module only applies that plan, out of the existing pieces:
 *
 * 1. `createTaskWithSideEffects` creates the half — it is also the target list's permission check
 *    (a list the caller may not add to refuses the create, and nothing else is written).
 * 2. `attachBlocker` links it as the source's blocker.
 * 3. `applyHandoffToSource` moves the source and remembers the holder in
 *    `Task.handoffReturnAssigneeId`; the wake paths in services/task-dependency.service.ts give the
 *    source back to that holder when the half completes (R8's `assignee: "return"`).
 *
 * Write access to the SOURCE is the caller's to check (the route does, as the blocker route does).
 */

import type { AnalyticsPlatformValue } from '@/lib/analytics-events'
import { createLogger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { renderLocale, loadMessages } from '@/lib/i18n/user-locale'
import { WAITING_STATUS_ROLE } from '@/lib/task-status'
import { waitingHandoff, HANDOFF_SOURCE_DONE } from '@/lib/waiting-rules'
import { applyHandoffToSource, attachBlocker } from '@/services/task-dependency.service'
import { loadWaitingBlockers } from '@/services/task-waiting'
import { createTaskWithSideEffects, type CreatedTask } from '@/services/task.service'

const log = createLogger('services.task-handoff')

export interface HandoffInput {
  /** The task being handed off, already resolved to its id. */
  sourceTaskId: string
  /** The list the other half is filed on. */
  targetListId: string
  title: string
  description?: string | null
  priority?: number
  /** The half's assignee. Omitted: unassigned, so the target board's queue picks it up. */
  assigneeId?: string | null
  /** Whose permissions the writes use (the authenticated caller); creator of the half. */
  actorId: string
  /** Who signs the link and the move on the activity lines — an agent writing with its owner's credentials. Defaults to `actorId`. */
  authorId?: string
  actorType?: 'user' | 'agent'
  platform?: AnalyticsPlatformValue
  now?: Date
}

export type HandoffResult =
  | {
      ok: true
      half: CreatedTask
      source: { id: string; statusRole: string | null; assigneeId: string | null }
      /** Who gets the source back when the half is done; null when nobody held it. */
      returnAssigneeId: string | null
    }
  | { ok: false; status: 400 | 403 | 404 | 409 | 422 | 429 | 502; error: string; code?: string }

/** The refusal sentence for a finished source, in the caller's language (i18n `waiting.handoff.sourceDone`). */
async function sourceDoneMessage(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { locale: true } }).catch(() => null)
  const [messages, english] = await Promise.all([loadMessages(renderLocale(user?.locale)), loadMessages(renderLocale(null))])
  return messages.waiting?.handoff?.sourceDone ?? english.waiting.handoff.sourceDone
}

export async function handoffTask(input: HandoffInput): Promise<HandoffResult> {
  const { sourceTaskId, targetListId, actorId, actorType = 'user', platform, now = new Date() } = input
  const authorId = input.authorId ?? actorId

  const title = typeof input.title === 'string' ? input.title.trim() : ''
  if (!title) return { ok: false, status: 400, error: 'title is required' }
  if (typeof targetListId !== 'string' || !targetListId.trim()) return { ok: false, status: 400, error: 'targetListId is required' }

  const source = await prisma.task.findUnique({
    where: { id: sourceTaskId },
    select: {
      id: true,
      statusRole: true,
      dueDateTime: true,
      isAllDay: true,
      assigneeId: true,
      completed: true,
      handoffReturnAssigneeId: true,
    },
  })
  if (!source) return { ok: false, status: 404, error: 'Task not found' }

  const plan = waitingHandoff(source, await loadWaitingBlockers(source.id), source.handoffReturnAssigneeId, now)
  if (!plan.ok) {
    return { ok: false, status: 409, error: await sourceDoneMessage(actorId), code: HANDOFF_SOURCE_DONE }
  }

  // The half first: it is the target list's permission check, and a refusal writes nothing.
  const created = await createTaskWithSideEffects({
    input: {
      title,
      description: input.description ?? '',
      priority: input.priority,
      listIds: [targetListId.trim()],
      assigneeId: input.assigneeId ?? null,
      statusRole: plan.value.half.statusRole,
    },
    actorId,
    platform,
    requireAssigneeListMembership: true,
  })
  if (!created.ok) return created
  const half = created.task

  await attachBlocker({ taskId: source.id, blockingTaskId: half.id, userId: authorId, actorType })

  const { source: write, returnAssigneeId } = plan.value
  if (write.transition === 'enter') {
    const moved = await applyHandoffToSource({
      taskId: source.id,
      from: source.statusRole ?? null,
      to: WAITING_STATUS_ROLE,
      clearAssignee: write.assignee === 'clear',
      formerAssigneeId: source.assigneeId,
      returnAssigneeId,
      actorId: authorId,
      actorType,
    })
    if (!moved) {
      // Somebody moved the source between the read and the write. The half and its link stand —
      // the source waits on it by whatever lane it is in now — but nothing is remembered.
      log.warn({ taskId: source.id }, 'handoff: the source moved before it could be parked in Waiting')
    }
  } else if (returnAssigneeId !== source.handoffReturnAssigneeId) {
    // Already waiting (R8 `stay`): it keeps its lane, and its holder is (still) remembered.
    await prisma.task.update({ where: { id: source.id }, data: { handoffReturnAssigneeId: returnAssigneeId } })
  }

  const after = await prisma.task.findUnique({
    where: { id: source.id },
    select: { id: true, statusRole: true, assigneeId: true },
  })
  return {
    ok: true,
    half,
    source: after ?? { id: source.id, statusRole: source.statusRole, assigneeId: source.assigneeId },
    returnAssigneeId,
  }
}
