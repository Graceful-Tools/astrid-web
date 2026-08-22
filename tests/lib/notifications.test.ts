/**
 * Regression tests for task ab0572cb — notification fan-out.
 *
 * The fan-out matrix decides who gets told what. Getting it wrong is not a
 * cosmetic bug: over-notifying makes the inbox worthless, and notifying the
 * actor about their own action erodes trust in it immediately.
 */

import { describe, it, expect } from 'vitest'
import {
  fanOutEvent,
  fanOutComment,
  notificationKindFor,
  shouldDeliverExternally,
  hasNotificationSurface,
  buildNotificationRows,
} from '@/lib/notifications'

describe('notificationKindFor (ab0572cb)', () => {
  it('maps the event kinds that are news', () => {
    expect(notificationKindFor('assigned')).toBe('assigned')
    expect(notificationKindFor('completed')).toBe('completed')
    expect(notificationKindFor('closed')).toBe('completed')
  })

  it('produces nothing for events that are history, not news', () => {
    // Title edits and due-date nudges belong in the activity trail. Notifying
    // on them turns the inbox into a firehose.
    expect(notificationKindFor('title_changed')).toBeNull()
    expect(notificationKindFor('due_changed')).toBeNull()
    expect(notificationKindFor('priority_changed')).toBeNull()
    expect(notificationKindFor('reopened')).toBeNull()
  })
})

describe('fanOutEvent (ab0572cb)', () => {
  it('NEVER notifies the actor about their own action', () => {
    // Nothing erodes trust in an inbox faster than it telling you what you
    // just did.
    const targets = fanOutEvent({
      kind: 'completed',
      actorId: 'alice',
      audience: { assigneeId: 'alice', creatorId: 'bob' },
    })
    expect(targets.map(t => t.userId)).toEqual(['bob'])
  })

  it('notifies only the new assignee on assignment', () => {
    // "Assigned" is news for exactly one person, not the whole audience.
    const targets = fanOutEvent({
      kind: 'assigned',
      actorId: 'alice',
      audience: { assigneeId: 'bob', creatorId: 'carol', commenterIds: ['dave'] },
    })
    expect(targets).toEqual([{ userId: 'bob', kind: 'assigned' }])
  })

  it('notifies the interested set on completion', () => {
    const targets = fanOutEvent({
      kind: 'completed',
      actorId: 'alice',
      audience: { assigneeId: 'bob', creatorId: 'carol', commenterIds: ['dave'] },
    })
    expect(targets.map(t => t.userId).sort()).toEqual(['bob', 'carol', 'dave'])
  })

  it('deduplicates someone who is assignee, creator and commenter', () => {
    const targets = fanOutEvent({
      kind: 'completed',
      actorId: 'alice',
      audience: { assigneeId: 'bob', creatorId: 'bob', commenterIds: ['bob', 'bob'] },
    })
    expect(targets).toHaveLength(1)
  })

  it('produces nothing for an event kind that is not news', () => {
    expect(fanOutEvent({ kind: 'title_changed', actorId: 'alice', audience: { creatorId: 'bob' } }))
      .toEqual([])
  })

  it('produces nothing when the only interested party is the actor', () => {
    expect(fanOutEvent({ kind: 'completed', actorId: 'alice', audience: { assigneeId: 'alice' } }))
      .toEqual([])
  })

  it('notifies mentioned users regardless of event kind mapping', () => {
    const targets = fanOutEvent({
      kind: 'completed',
      actorId: 'alice',
      audience: { mentionedUserIds: ['erin'] },
    })
    expect(targets.map(t => t.userId)).toContain('erin')
  })
})

describe('fanOutComment (ab0572cb)', () => {
  it('tells the thread about a new comment', () => {
    const targets = fanOutComment({
      actorId: 'alice',
      audience: { assigneeId: 'bob', creatorId: 'carol' },
    })
    expect(targets.map(t => t.userId).sort()).toEqual(['bob', 'carol'])
    expect(targets.every(t => t.kind === 'commented')).toBe(true)
  })

  it('marks a reply as a reply for the parent author', () => {
    const targets = fanOutComment({
      actorId: 'alice',
      audience: { assigneeId: 'bob' },
      parentAuthorId: 'bob',
    })
    expect(targets).toEqual([{ userId: 'bob', kind: 'replied' }])
  })

  it('lets a mention win over a reply, and a reply over a plain comment', () => {
    // The most specific reason you are being told wins — being @-mentioned in
    // a reply is a mention, not a generic thread update.
    const targets = fanOutComment({
      actorId: 'alice',
      audience: { assigneeId: 'bob', mentionedUserIds: ['bob'] },
      parentAuthorId: 'bob',
    })
    expect(targets).toEqual([{ userId: 'bob', kind: 'mentioned' }])
  })

  it('never notifies the comment author about their own comment', () => {
    const targets = fanOutComment({
      actorId: 'alice',
      audience: { assigneeId: 'alice', creatorId: 'alice', mentionedUserIds: ['alice'] },
    })
    expect(targets).toEqual([])
  })
})

describe('shouldDeliverExternally (ab0572cb)', () => {
  it('pushes and emails things addressed to you personally', () => {
    expect(shouldDeliverExternally('assigned', null)).toEqual({ push: true, email: true })
    expect(shouldDeliverExternally('mentioned', null)).toEqual({ push: true, email: true })
    expect(shouldDeliverExternally('replied', null)).toEqual({ push: true, email: true })
  })

  it('keeps status churn in-app only', () => {
    // Status changes on a shared board are the fastest way to make an inbox
    // worthless; they are not worth a phone buzz.
    expect(shouldDeliverExternally('status_changed', null)).toEqual({ push: false, email: false })
    expect(shouldDeliverExternally('commented', null)).toEqual({ push: false, email: false })
  })

  it('respects the user\'s existing reminder preferences', () => {
    expect(shouldDeliverExternally('assigned', { enablePushReminders: false }))
      .toEqual({ push: false, email: true })
    expect(shouldDeliverExternally('assigned', { enableEmailReminders: false }))
      .toEqual({ push: true, email: false })
  })
})

describe('hasNotificationSurface (ab0572cb)', () => {
  it('is false for a purely solo user', () => {
    // Progressive disclosure: a solo user never grows a notification surface.
    expect(hasNotificationSurface({ sharedListCount: 0, projectCount: 0 })).toBe(false)
  })

  it('is true once anything is shared', () => {
    expect(hasNotificationSurface({ sharedListCount: 1, projectCount: 0 })).toBe(true)
    expect(hasNotificationSurface({ sharedListCount: 0, projectCount: 1 })).toBe(true)
  })
})

describe('buildNotificationRows (ab0572cb)', () => {
  it('maps notification targets into notification rows and deduplicates identical rows', () => {
    const rows = buildNotificationRows(
      [
        { userId: 'alice', kind: 'assigned' },
        { userId: 'alice', kind: 'assigned' },
        { userId: 'bob', kind: 'mentioned' },
      ],
      { taskId: 'task-1', commentId: 'comment-1', actorId: 'actor-1' }
    )

    expect(rows).toEqual([
      {
        userId: 'alice',
        kind: 'assigned',
        taskId: 'task-1',
        commentId: 'comment-1',
        actorId: 'actor-1',
      },
      {
        userId: 'bob',
        kind: 'mentioned',
        taskId: 'task-1',
        commentId: 'comment-1',
        actorId: 'actor-1',
      },
    ])
  })
})
