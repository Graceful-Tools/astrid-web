/**
 * Notification fan-out (task ab0572cb).
 *
 * Astrid's notification system was **due-date only**: ReminderQueue fires when
 * a task is due, and nothing fired when a task was assigned to you, you were
 * @-mentioned, someone replied to your comment, or work you're involved in
 * changed state. The @-mention syntax already parsed — it just went nowhere.
 *
 * Notifications are **derived from TaskEvent** (task 51a4b8ff), never written
 * independently. Two write paths for "something happened" would guarantee
 * drift, and the event trail is already the thing that knows who did what.
 */

import type { TaskEventKind, TaskEventActorType } from '@/lib/task-events'

export const NOTIFICATION_KINDS = [
  'assigned',
  'mentioned',
  'replied',
  'commented',
  'status_changed',
  'completed',
] as const

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

/**
 * Who is interested in a task.
 *
 * Assignee + creator + anyone who has commented, plus explicit mentions.
 * Deliberately NOT "every member of the list": on a shared list of any size
 * that turns every edit into a broadcast, and an inbox that is mostly noise is
 * one people stop opening.
 */
export interface TaskAudience {
  assigneeId?: string | null
  creatorId?: string | null
  commenterIds?: string[]
  mentionedUserIds?: string[]
}

export interface FanOutInput {
  kind: TaskEventKind
  actorId?: string | null
  actorType?: TaskEventActorType
  audience: TaskAudience
}

export interface NotificationTarget {
  userId: string
  kind: NotificationKind
}

/**
 * Which event kinds produce a notification, and as what.
 *
 * Most events (title edits, due-date nudges, list membership) deliberately do
 * NOT notify: they are history, not news. Status churn on a busy board is the
 * fastest way to make an inbox worthless.
 */
const EVENT_TO_NOTIFICATION: Partial<Record<TaskEventKind, NotificationKind>> = {
  assigned: 'assigned',
  completed: 'completed',
  closed: 'completed',
  status_changed: 'status_changed',
  list_added: 'status_changed',
}

export function notificationKindFor(eventKind: TaskEventKind): NotificationKind | null {
  return EVENT_TO_NOTIFICATION[eventKind] ?? null
}

/**
 * Fan one event out to the people who should hear about it.
 *
 * Rules, in order:
 *   1. The actor is never notified about their own action. Nothing erodes
 *      trust in an inbox faster than it telling you what you just did.
 *   2. An assignment notifies the new assignee specifically — that is news for
 *      exactly one person, not for the whole audience.
 *   3. Everything else notifies the interested set, deduplicated.
 *
 * Returns targets; delivery and permission filtering are the caller's job.
 */
export function fanOutEvent(input: FanOutInput): NotificationTarget[] {
  const kind = notificationKindFor(input.kind)
  if (!kind) return []

  const targets = new Set<string>()

  if (input.kind === 'assigned') {
    // The assignee is the only person for whom "assigned" is news.
    if (input.audience.assigneeId) targets.add(input.audience.assigneeId)
  } else {
    if (input.audience.assigneeId) targets.add(input.audience.assigneeId)
    if (input.audience.creatorId) targets.add(input.audience.creatorId)
    for (const id of input.audience.commenterIds ?? []) targets.add(id)
  }

  for (const id of input.audience.mentionedUserIds ?? []) targets.add(id)

  // Never notify the actor about their own action.
  if (input.actorId) targets.delete(input.actorId)

  return Array.from(targets).map(userId => ({ userId, kind }))
}

/**
 * Fan a new comment out.
 *
 * Separate from events because a comment is not a task mutation: it has its
 * own kinds (a reply to your comment is different news from a comment on a
 * task you follow) and its own audience (mentions).
 */
export function fanOutComment(input: {
  actorId?: string | null
  audience: TaskAudience
  /** Author of the comment being replied to, if any. */
  parentAuthorId?: string | null
}): NotificationTarget[] {
  const targets = new Map<string, NotificationKind>()

  const add = (userId: string | null | undefined, kind: NotificationKind) => {
    if (!userId) return
    // A more specific kind wins: being mentioned in a reply is a mention.
    const existing = targets.get(userId)
    if (existing === 'mentioned') return
    if (existing === 'replied' && kind !== 'mentioned') return
    targets.set(userId, kind)
  }

  add(input.audience.assigneeId, 'commented')
  add(input.audience.creatorId, 'commented')
  for (const id of input.audience.commenterIds ?? []) add(id, 'commented')
  add(input.parentAuthorId, 'replied')
  for (const id of input.audience.mentionedUserIds ?? []) add(id, 'mentioned')

  if (input.actorId) targets.delete(input.actorId)

  return Array.from(targets, ([userId, kind]) => ({ userId, kind }))
}

export interface DeliveryPreferences {
  enablePushReminders?: boolean
  enableEmailReminders?: boolean
}

/**
 * Should this notification kind be pushed/emailed, or only shown in-app?
 *
 * Assignment and mention default ON: they are addressed to you personally.
 * Status changes default to **in-app only** — status churn on a shared board
 * is the fastest way to make an inbox worthless, and it is not worth a phone
 * buzz.
 */
export function shouldDeliverExternally(
  kind: NotificationKind,
  preferences: DeliveryPreferences | null | undefined
): { push: boolean; email: boolean } {
  const personal = kind === 'assigned' || kind === 'mentioned' || kind === 'replied'
  if (!personal) return { push: false, email: false }

  return {
    push: preferences?.enablePushReminders !== false,
    email: preferences?.enableEmailReminders !== false,
  }
}

/**
 * Does this user have any relationship that could produce a notification?
 *
 * Drives progressive disclosure: the bell renders only for someone on a shared
 * list or a project. A purely solo user never grows a notification surface.
 */
export function hasNotificationSurface(input: {
  sharedListCount: number
  projectCount: number
}): boolean {
  return input.sharedListCount > 0 || input.projectCount > 0
}
