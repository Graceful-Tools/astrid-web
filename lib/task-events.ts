/**
 * Append-only task activity history (task 51a4b8ff).
 *
 * There was no audit trail anywhere in the schema — `Comment` was the only
 * record of what happened to a task. Nobody could answer "who moved this to
 * Doing, and when".
 *
 * This matters more in Astrid than in a conventional tracker because **AI
 * agents mutate tasks autonomously**. An agent reassigning, re-prioritising or
 * completing work with no trace is a trust problem, and it makes agent
 * misbehaviour impossible to debug.
 *
 * Relationship to lib/task-state-change-tracker.ts: that module produces the
 * *prose* a human reads in the comment thread ("changed priority from ! to
 * !!!"). This one produces *structured* rows — kind, from, to, actor type —
 * that can be queried, counted and fanned out into notifications. They share
 * the field vocabulary deliberately; merging them would force one shape to
 * serve two jobs badly.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'

const log = createLogger('task-events')

type PrismaLike = typeof prisma | Prisma.TransactionClient

export const TASK_EVENT_KINDS = [
  'created',
  'completed',
  'reopened',
  'closed',
  'assigned',
  'unassigned',
  'priority_changed',
  'due_changed',
  'status_changed',
  'list_added',
  'list_removed',
  'title_changed',
] as const

export type TaskEventKind = (typeof TASK_EVENT_KINDS)[number]

/**
 * Who caused the change. `sync` carries the provider, which finally makes
 * "why did this task change overnight?" answerable.
 */
export type TaskEventActorType = 'user' | 'agent' | 'sync' | 'system'

export interface TaskEventInput {
  kind: TaskEventKind
  from?: unknown
  to?: unknown
}

export interface TaskEventSnapshot {
  title?: string | null
  completed?: boolean | null
  closedReason?: string | null
  priority?: number | null
  assigneeId?: string | null
  dueDateTime?: Date | string | null
  listIds?: string[]
}

function sameTime(a: Date | string | null | undefined, b: Date | string | null | undefined): boolean {
  const left = a ? new Date(a).getTime() : null
  const right = b ? new Date(b).getTime() : null
  return left === right
}

/**
 * Diff two task snapshots into structured events.
 *
 * Pure — no database access — so it is trivially testable and can run inside
 * or outside a transaction.
 *
 * Completion is expressed as three distinct kinds rather than one
 * `completed_changed`, because "done", "won't do" and "reopened" are the three
 * outcomes anyone reporting on this actually wants to tell apart.
 */
export function diffTaskEvents(
  before: TaskEventSnapshot,
  after: TaskEventSnapshot
): TaskEventInput[] {
  const events: TaskEventInput[] = []

  if (after.title !== undefined && before.title !== after.title) {
    events.push({ kind: 'title_changed', from: before.title, to: after.title })
  }

  if (after.completed !== undefined && before.completed !== after.completed) {
    if (after.completed) {
      events.push(
        after.closedReason
          ? { kind: 'closed', from: before.closedReason ?? null, to: after.closedReason }
          : { kind: 'completed', from: false, to: true }
      )
    } else {
      events.push({ kind: 'reopened', from: true, to: false })
    }
  } else if (
    after.closedReason !== undefined &&
    before.closedReason !== after.closedReason &&
    after.completed
  ) {
    // Reason changed without the completed flag moving — e.g. "done" reclassified
    // as "won't do".
    events.push({ kind: 'closed', from: before.closedReason ?? null, to: after.closedReason })
  }

  if (after.priority !== undefined && before.priority !== after.priority) {
    events.push({ kind: 'priority_changed', from: before.priority, to: after.priority })
  }

  if (after.assigneeId !== undefined && before.assigneeId !== after.assigneeId) {
    events.push(
      after.assigneeId
        ? { kind: 'assigned', from: before.assigneeId ?? null, to: after.assigneeId }
        : { kind: 'unassigned', from: before.assigneeId ?? null, to: null }
    )
  }

  if (after.dueDateTime !== undefined && !sameTime(before.dueDateTime, after.dueDateTime)) {
    events.push({
      kind: 'due_changed',
      from: before.dueDateTime ? new Date(before.dueDateTime).toISOString() : null,
      to: after.dueDateTime ? new Date(after.dueDateTime).toISOString() : null,
    })
  }

  if (after.listIds !== undefined) {
    const beforeIds = new Set(before.listIds ?? [])
    const afterIds = new Set(after.listIds)
    for (const id of afterIds) {
      if (!beforeIds.has(id)) events.push({ kind: 'list_added', to: id })
    }
    for (const id of beforeIds) {
      if (!afterIds.has(id)) events.push({ kind: 'list_removed', from: id })
    }
  }

  return events
}

export interface RecordTaskEventsArgs {
  taskId: string
  actorId?: string | null
  actorType: TaskEventActorType
  events: TaskEventInput[]
  client?: PrismaLike
}

/**
 * Persist events. **Best-effort by contract**: a failure here is logged and
 * swallowed, never thrown.
 *
 * An audit trail is valuable, but not more valuable than the mutation it
 * describes — losing someone's task edit because the history write failed
 * would be a strictly worse bug than having no history.
 *
 * Called from ONE place per surface so `/api/tasks` and `/api/v1/tasks` cannot
 * drift the way they did before `lib/projects-service.ts` unified projects.
 */
export async function recordTaskEvents({
  taskId,
  actorId,
  actorType,
  events,
  client = prisma,
}: RecordTaskEventsArgs): Promise<void> {
  if (events.length === 0) return

  try {
    await client.taskEvent.createMany({
      data: events.map(event => ({
        taskId,
        actorId: actorId ?? null,
        actorType,
        kind: event.kind,
        from: (event.from ?? null) as Prisma.InputJsonValue,
        to: (event.to ?? null) as Prisma.InputJsonValue,
      })),
    })
  } catch (err) {
    log.error({ err, taskId, count: events.length }, 'Failed to record task events')
  }
}

/**
 * Collapse a burst of edits by the same actor to the same field.
 *
 * Someone dragging a priority slider or retyping a title produces a run of
 * updates that are one intent, not twelve. Keeps the last value of each
 * (actor, kind) pair inside the window and drops the rest.
 *
 * Note `from` is taken from the EARLIEST event in the run and `to` from the
 * latest, so the collapsed event still describes the whole transition rather
 * than just its final hop.
 */
export function coalesceEvents<T extends { kind: string; actorId?: string | null; from?: unknown; to?: unknown }>(
  events: T[]
): T[] {
  const byKey = new Map<string, T>()
  const order: string[] = []

  for (const event of events) {
    // list_added / list_removed carry their identity in the value, so
    // collapsing them by kind alone would lose memberships.
    const key = event.kind === 'list_added' || event.kind === 'list_removed'
      ? `${event.actorId ?? ''}:${event.kind}:${String(event.to ?? event.from ?? '')}`
      : `${event.actorId ?? ''}:${event.kind}`

    const existing = byKey.get(key)
    if (existing) {
      byKey.set(key, { ...existing, to: event.to })
    } else {
      byKey.set(key, event)
      order.push(key)
    }
  }

  return order.map(key => byKey.get(key) as T)
}
