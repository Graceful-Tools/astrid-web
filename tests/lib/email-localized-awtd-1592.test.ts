/**
 * AWTD-1592 — reminder and digest emails are written in the recipient's
 * language (`User.locale`), English when it is not known.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import de from '@/lib/i18n/locales/de.json'

const { sent } = vi.hoisted(() => ({ sent: [] as Array<{ subject: string; html: string; text: string }> }))
vi.mock('@/lib/email-transport', () => ({
  isEmailTransportLive: () => true,
  sendTransportEmail: async (mail: { subject: string; html: string; text: string }) => {
    sent.push(mail)
    return { id: 'm1' }
  },
}))

import { EmailReminderService } from '@/lib/email-reminder-service'

const e = de.notifications.email
const NOW = new Date('2026-11-09T08:00:00Z')

const task = (over: Record<string, unknown> = {}) => ({
  taskId: 't1',
  title: 'Miete & Strom',
  dueDateTime: new Date('2026-11-09T16:00:00Z'),
  listNames: ['Haus'],
  ...over,
})

describe('localized reminder emails (AWTD-1592)', () => {
  beforeEach(() => {
    sent.length = 0
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  it('a German daily digest is German from subject to footer', async () => {
    await new EmailReminderService().sendDailyDigest({
      userId: 'u1', userEmail: 'u@example.com', userName: 'U', locale: 'de', timeZone: 'Europe/Berlin',
      overdueTasks: [], dueTodayTasks: [task()], dueTomorrowTasks: [], upcomingTasks: [],
    })
    const mail = sent[0]
    expect(mail.subject).toBe(e.daily.subject.replace('{date}', '9. November'))
    expect(mail.html).toContain('<html lang="de">')
    expect(mail.html).toContain(e.daily.intro)
    expect(mail.html).toContain('Montag, 9. November 2026')
    expect(mail.html).toContain(e.daily.unsubscribe)
    expect(mail.html).toContain('Miete &amp; Strom')
    expect(mail.text).toContain(e.daily.intro)
    expect(mail.html).not.toContain('Reminding you about')
  })

  it('a German task reminder is German, and its quote comes from the German reminders', async () => {
    await new EmailReminderService().sendTaskReminder({ ...task(), assigneeEmail: 'u@example.com', assigneeName: 'Ana', locale: 'de' })
    const mail = sent[0]
    expect(mail.subject.startsWith(e.reminder.subject.split('{title}')[0])).toBe(true)
    expect(mail.subject).toContain('Miete & Strom')
    expect(mail.html).toContain(e.reminder.assignedTo)
    expect(mail.html).toContain(de.notifications.actions.snoozeReminder)
    expect(mail.text).toContain(e.reminder.textDueSoonNote)
    const germanQuotes = Object.values(de.reminders.responses)
    expect(germanQuotes.some((q) => mail.html.includes(String(q)))).toBe(true)
  })

  it('a German weekly digest is German', async () => {
    await new EmailReminderService().sendWeeklyDigest({
      userId: 'u1', userEmail: 'u@example.com', userName: 'Ana', locale: 'de', timeZone: 'Europe/Berlin',
      upcomingTasks: [task()],
    })
    const mail = sent[0]
    expect(mail.subject.startsWith(e.weekly.subject.split('{range}')[0])).toBe(true)
    expect(mail.html).toContain(e.weekly.title)
    expect(mail.html).toContain(e.weekly.helloNamed.replace('{name}', 'Ana'))
    expect(mail.text).toContain(e.weekly.footerWhy)
  })

  it('with no language the emails stay English', async () => {
    await new EmailReminderService().sendDailyDigest({
      userId: 'u1', userEmail: 'u@example.com', userName: 'U', timeZone: 'Europe/Berlin',
      overdueTasks: [], dueTodayTasks: [task()], dueTomorrowTasks: [], upcomingTasks: [],
    })
    expect(sent[0].subject).toBe('Reminders for November 9')
    expect(sent[0].html).toContain('Reminding you about the things that are important to you.')
  })
})
