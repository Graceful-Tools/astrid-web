/**
 * AWTD-1592 — push notifications speak the recipient's language.
 *
 * Every push was English. The copy is now read from the `notifications` key group
 * in the recipient's `User.locale`, and each payload carries the service worker's
 * own labels (its buttons and its "snoozed" / "completed" toasts), because the
 * worker has no language of its own when a push wakes it with no page open.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import de from '@/lib/i18n/locales/de.json'
import en from '@/lib/i18n/locales/en.json'

const { sent, userLocale, prismaMock } = vi.hoisted(() => {
  const userLocale = { value: null as string | null }
  return {
    sent: [] as Array<Record<string, any>>,
    userLocale,
    prismaMock: {
      pushSubscription: {
        findMany: async () => [{ id: 'sub-1', endpoint: 'https://push.example/1', p256dh: 'k', auth: 'a' }],
        update: async () => ({}),
      },
      user: { findUnique: async () => ({ locale: userLocale.value }) },
    },
  }
})

vi.mock('web-push', () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(async (_sub: unknown, body: string) => {
      sent.push(JSON.parse(body))
    }),
  },
}))
vi.mock('@/lib/field-encryption', () => ({ decryptField: (v: string) => v }))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import { PushNotificationService } from '@/lib/push-notification-service'

const deN = de.notifications
const enN = en.notifications

describe('localized push notifications (AWTD-1592)', () => {
  beforeEach(() => {
    sent.length = 0
    userLocale.value = null
  })

  it('a German user gets a German comment push', async () => {
    userLocale.value = 'de'
    await new PushNotificationService(prismaMock as any).sendCommentNotification('u1', {
      taskId: 't1', commentId: 'c1', taskTitle: 'Miete', commenterName: 'Ana', content: 'Erledigt?', type: 'assignment',
    })
    expect(sent).toHaveLength(1)
    expect(sent[0].title).toBe(deN.push.commentTitle)
    expect(sent[0].body).toContain('Ana')
    expect(sent[0].body).toContain('Erledigt?')
  })

  it('a German user gets a German chat-mention title', async () => {
    userLocale.value = 'de'
    await new PushNotificationService(prismaMock as any).sendChatMentionNotification('u1', {
      channelId: 'ch', messageId: 'm', senderName: 'Ana', content: 'hallo',
    })
    expect(sent[0].title).toBe(deN.push.chatMentionTitle.replace('{name}', 'Ana'))
  })

  it('an unknown language stays English, word for word', async () => {
    await new PushNotificationService(prismaMock as any).sendCommentNotification('u1', {
      taskId: 't1', commentId: 'c1', taskTitle: 'Rent', commenterName: 'Ana', content: 'Done?', type: 'mention',
    })
    expect(sent[0].title).toBe('Ana mentioned you')
    expect(sent[0].body).toBe('"Done?" in Rent')
  })

  it('every push carries the service worker labels in the recipient language', async () => {
    userLocale.value = 'de'
    await new PushNotificationService(prismaMock as any).sendNotification('u1', { title: 'x', body: 'y', data: { taskId: 't1' } })
    const labels = sent[0].data.labels
    expect(labels.snoozedTitle).toBe(deN.worker.snoozedTitle)
    expect(labels.completeFailedBody).toBe(deN.worker.completeFailedBody)
    expect(labels.dismiss).toBe(deN.actions.dismiss)
    // The worker fills these in itself.
    expect(labels.snoozedBody).toContain('{minutes}')
    expect(sent[0].data.taskId).toBe('t1')
  })

  it('English labels match the strings the worker used to hardcode', async () => {
    await new PushNotificationService(prismaMock as any).sendNotification('u1', { title: 'x', body: 'y' })
    const labels = sent[0].data.labels
    expect(labels.snoozedTitle).toBe('Task Snoozed')
    expect(labels.snoozedBody).toBe('Reminder snoozed for {minutes} minutes')
    expect(labels.openApp).toBe(enN.actions.openApp)
  })
})
