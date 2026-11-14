/**
 * The language an email is written in, and the date words inside it (AWTD-1592).
 * Moved out of lib/email-reminder-service.ts with the localisation, which would
 * otherwise have grown that file past its budget (tests/rules/oversized-files-ratchet).
 */
import type { TaskReminderData } from '@/types/reminder'
import { digestDueText } from '@/lib/digest-email-dates'
import {
  clockOptions,
  englishNotificationTranslator,
  getNotificationTranslator,
  intlTag,
  loadMessages,
  renderLocale,
  type NotificationTranslator,
} from '@/lib/i18n/user-locale'
import type { Locale } from '@/lib/i18n/config'

/**
 * The words an email is written in: the recipient's `User.locale` (AWTD-1592).
 * `messages` is the whole locale, which the reminder quotes read; without it the
 * quote is the fixed English fallback.
 */
export interface EmailCopy {
  locale: Locale
  t: NotificationTranslator
  messages?: unknown
}

/** English, synchronously: what an email is written in when nothing says otherwise. */
export function englishCopy(): EmailCopy {
  return { locale: 'en', t: englishNotificationTranslator() }
}

export async function copyFor(stored: string | null | undefined): Promise<EmailCopy> {
  const locale = renderLocale(stored)
  const [t, messages] = await Promise.all([getNotificationTranslator(locale), loadMessages(locale)])
  return { locale, t, messages }
}

export function formatReminderDue(dueDateTime: Date | null, isOverdue: unknown = false, copy: EmailCopy = englishCopy()): string {
  const { t, locale } = copy
  if (!dueDateTime) return t('dates.noDueDate')

  const due = new Date(dueDateTime)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dueDate = new Date(due.getFullYear(), due.getMonth(), due.getDate())

  const diffTime = dueDate.getTime() - today.getTime()
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

  const timeString = due.toLocaleTimeString(intlTag(locale), clockOptions(locale))

  const dateString = due.toLocaleDateString(intlTag(locale), {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  })
  const dateAt = t('dates.dateAt', { date: dateString, time: timeString })

  if (isOverdue) {
    return t('dates.overdueBy', { when: dateAt, count: Math.abs(diffDays) })
  } else if (diffDays === 0) {
    return t('dates.todayAt', { time: timeString })
  } else if (diffDays === 1) {
    return t('dates.tomorrowAt', { time: timeString })
  } else if (diffDays === -1) {
    return t('dates.yesterdayAt', { time: timeString })
  } else {
    return dateAt
  }
}

/** "in 2 days" / "in 3 hours", in the reader's language (Intl gives English exactly as before). */
export function timeUntilDue(dueDateTime: Date | null, locale: Locale = 'en'): string | null {
  if (!dueDateTime) return null

  const due = new Date(dueDateTime)
  const now = new Date()
  const diffMs = due.getTime() - now.getTime()
  
  if (diffMs <= 0) return null

  const diffMinutes = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)

  const relative = new Intl.RelativeTimeFormat(intlTag(locale), { numeric: 'always' })
  if (diffDays > 0) {
    return relative.format(diffDays, 'day')
  } else if (diffHours > 0) {
    return relative.format(diffHours, 'hour')
  } else if (diffMinutes > 0) {
    return relative.format(diffMinutes, 'minute')
  } else {
    return new Intl.RelativeTimeFormat(intlTag(locale), { numeric: 'auto' }).format(0, 'second')
  }
}

/** A digest task's due text on the recipient's calendar (AWTD-1545), in their language (AWTD-1592). */
export function digestTaskDue(task: TaskReminderData, timeZone: string | undefined, copy: EmailCopy = englishCopy()): string {
  if (!task.dueDateTime) return copy.t('dates.noDueDate')
  return digestDueText(new Date(task.dueDateTime), {
    now: new Date(),
    zone: timeZone,
    isAllDay: task.isAllDay,
    locale: copy.locale,
    t: copy.t,
  })
}
