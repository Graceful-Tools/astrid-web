import { BRAND } from '@/lib/brand/config'
import { DANGER_COLOR, accentGradientStops, dangerGradientStops } from '@/lib/brand/colors'
import type { TaskReminderData, DailyDigestData } from '@/types/reminder'
import { sendVerificationEmail, getFromEmail } from '@/lib/email'
import { isEmailTransportLive, sendTransportEmail } from '@/lib/email-transport'
import { getRandomReminderString } from '@/lib/reminder-constants'
import { getBaseUrl, getUnsubscribeUrl, buildTaskUrlWithContext } from '@/lib/base-url'
import { createLogger } from '@/lib/logger'
import { escapeEmailHtml } from '@/lib/email-html'
import { EMAIL_PALETTE, emailRgb as tokenColor, washOver } from '@/lib/design/email-palette' // an email cannot read a custom property (AWTD-1596)
import { digestLongDate, digestShortDate, digestWeekRange } from '@/lib/digest-email-dates'
import { copyFor, digestTaskDue, englishCopy, formatReminderDue, timeUntilDue, type EmailCopy } from '@/lib/email-copy'

const log = createLogger('email-reminder-service')

export class EmailReminderService {
  async sendTaskReminder(data: TaskReminderData): Promise<void> {
    const copy = await copyFor(data.locale)
    const subject = this.getTaskReminderSubject(data, copy)
    const htmlBody = this.getTaskReminderHtml(data, copy)
    const textBody = this.getTaskReminderText(data, copy)

    await this.sendEmail({
      to: data.assigneeEmail || '',
      subject,
      html: htmlBody,
      text: textBody,
    })
  }

  async sendDailyDigest(data: DailyDigestData): Promise<void> {
    const copy = await copyFor(data.locale)
    const today = digestShortDate(new Date(), data.timeZone, copy.locale)
    const subject = copy.t('email.daily.subject', { date: today })
    const htmlBody = this.getDailyDigestHtml(data, copy)
    const textBody = this.getDailyDigestText(data, copy)

    await this.sendEmail({
      to: data.userEmail,
      subject,
      html: htmlBody,
      text: textBody,
    })
  }

  async sendWeeklyDigest(data: {
    userId: string
    userEmail: string
    userName: string
    upcomingTasks: TaskReminderData[]
    /** The recipient's `dailyDigestTimezone` (AWTD-1545). */
    timeZone?: string
    /** The recipient's `User.locale` (AWTD-1592). */
    locale?: string | null
  }): Promise<void> {
    const copy = await copyFor(data.locale)
    const subject = copy.t('email.weekly.subject', { range: digestWeekRange(new Date(), data.timeZone, copy.locale) })
    const htmlBody = this.getWeeklyDigestHtml(data, copy)
    const textBody = this.getWeeklyDigestText(data, copy)

    await this.sendEmail({
      to: data.userEmail,
      subject,
      html: htmlBody,
      text: textBody,
    })
  }

  private async sendEmail({
    to,
    subject,
    html,
    text,
  }: {
    to: string
    subject: string
    html: string
    text: string
  }): Promise<void> {
    const fromEmail = getFromEmail()

    // In development, just log the email
    if (!isEmailTransportLive()) {
      log.info("📧 Reminder Email (Development Mode)")
      log.info({ to }, "To:")
      log.info({ subject }, "Subject:")
      log.info({ snippet: text.substring(0, 200) + "..." }, "Text")
      return
    }

    try {
      const emailData = await sendTransportEmail({
        from: fromEmail,
        to,
        subject,
        html,
        text,
      })

      log.info({ id: emailData?.id, to }, '📧 Reminder email sent successfully:')
    } catch (error) {
      log.error({ err: error }, 'Error sending reminder email:')
      throw error
    }
  }

  private getTaskReminderSubject(data: TaskReminderData, copy: EmailCopy = englishCopy()): string {
    const { t } = copy
    const isOverdue = data.dueDateTime && new Date(data.dueDateTime) < new Date()
    
    if (isOverdue) {
      return t('email.reminder.subjectOverdue', { title: data.title })
    }

    const when = timeUntilDue(data.dueDateTime, copy.locale)
    return when
      ? t('email.reminder.subjectDue', { title: data.title, when })
      : t('email.reminder.subject', { title: data.title })
  }

  private getTaskReminderHtml(data: TaskReminderData, copy: EmailCopy = englishCopy()): string {
    const { t } = copy
    const h = escapeEmailHtml
    const isOverdue = data.dueDateTime && new Date(data.dueDateTime) < new Date()
    const dueText = formatReminderDue(data.dueDateTime, isOverdue, copy)
    const footerWhy = data.listNames.length > 0
      ? t('email.reminder.footerWhyInLists', { lists: data.listNames.join(', ') })
      : t('email.reminder.footerWhy')
    const quote = isOverdue
      ? getRandomReminderString('reminders_due', copy.locale, copy.messages)
      : getRandomReminderString('reminder_responses', copy.locale, copy.messages)
    const baseUrl = this.getAppUrl()
    const isSharedList = (data.collaborators?.length || 0) > 0

    return `
      <!DOCTYPE html>
      <html lang="${copy.locale}">
      <head>
        <meta charset="utf-8">
        <title>${h(t('email.reminder.pageTitle'))}</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: ${EMAIL_PALETTE.text};
            background-color: ${EMAIL_PALETTE.bgSecondary};
            margin: 0;
            padding: 20px;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            background-color: white;
            border-radius: 16px;
            overflow: hidden;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
          }
          .header {
            background: linear-gradient(135deg, ${dangerGradientStops()[0]} 0%, ${dangerGradientStops()[1]} 100%);
            padding: 30px 20px;
            text-align: center;
          }
          .header.normal {
            background: linear-gradient(135deg, ${accentGradientStops()[0]} 0%, ${accentGradientStops()[1]} 100%);
          }
          .astrid-section {
            padding: 40px 20px;
            text-align: center;
            background-color: ${EMAIL_PALETTE.errorWash};
            position: relative;
          }
          .astrid-section.normal {
            background-color: ${washOver(BRAND.accentColor, EMAIL_PALETTE.card)};
          }
          .astrid-container {
            display: flex;
            align-items: flex-start;
            justify-content: center;
            gap: 20px;
            max-width: 600px;
            margin: 0 auto;
          }
          .astrid-icon {
            flex-shrink: 0;
            width: 120px;
            height: 120px;
          }
          .astrid-icon img {
            width: 120px;
            height: 120px;
            display: block;
          }
          .speech-bubble {
            position: relative;
            background-color: white;
            border: 3px solid ${EMAIL_PALETTE.text};
            border-radius: 20px;
            padding: 20px 24px;
            margin-top: 10px;
            flex: 1;
            min-width: 200px;
            box-shadow: 4px 4px 0px rgba(0, 0, 0, 0.1);
          }
          .speech-bubble:before {
            content: '';
            position: absolute;
            left: -20px;
            top: 30px;
            width: 0;
            height: 0;
            border-top: 15px solid transparent;
            border-right: 20px solid ${EMAIL_PALETTE.text};
            border-bottom: 15px solid transparent;
          }
          .speech-bubble:after {
            content: '';
            position: absolute;
            left: -14px;
            top: 33px;
            width: 0;
            height: 0;
            border-top: 12px solid transparent;
            border-right: 17px solid white;
            border-bottom: 12px solid transparent;
          }
          .quote-text {
            font-size: 18px;
            font-weight: 600;
            color: ${EMAIL_PALETTE.text};
            text-align: left;
            margin: 0;
            line-height: 1.4;
          }
          .task-title {
            font-size: 28px;
            font-weight: bold;
            color: white;
            margin: 0 0 10px 0;
          }
          .due-info {
            font-size: 16px;
            color: rgba(255, 255, 255, 0.95);
            margin: 0;
          }
          .task-details {
            padding: 30px 20px;
          }
          .detail-row {
            padding: 12px 0;
            border-bottom: 1px solid ${EMAIL_PALETTE.border};
          }
          .detail-row:last-child {
            border-bottom: none;
          }
          .detail-label {
            font-weight: 600;
            color: ${EMAIL_PALETTE.textMuted};
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 4px;
          }
          .detail-value {
            color: ${EMAIL_PALETTE.text};
            font-size: 16px;
          }
          .collaborators-section {
            background-color: ${EMAIL_PALETTE.warningWash};
            padding: 20px;
            margin: 20px;
            border-radius: 12px;
            text-align: center;
          }
          .collaborators-title {
            font-size: 14px;
            font-weight: 600;
            color: ${EMAIL_PALETTE.warningInk};
            margin-bottom: 12px;
          }
          .collaborators-avatars {
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 8px;
            margin-bottom: 8px;
          }
          .avatar {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background-color: ${BRAND.accentColor};
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 600;
            font-size: 16px;
            border: 2px solid white;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
          }
          .collaborators-message {
            font-size: 16px;
            font-weight: 600;
            color: ${EMAIL_PALETTE.warningInk};
          }
          .actions {
            text-align: center;
            padding: 30px 20px;
            background-color: ${EMAIL_PALETTE.bgSecondary};
          }
          .button {
            background-color: ${isOverdue ? DANGER_COLOR : BRAND.accentColor};
            color: white;
            padding: 14px 28px;
            text-decoration: none;
            border-radius: 8px;
            display: inline-block;
            margin: 8px;
            font-weight: 600;
            font-size: 16px;
            transition: background-color 0.2s;
          }
          .button:hover {
            background-color: ${isOverdue ? dangerGradientStops()[1] : accentGradientStops()[1]};
          }
          .button-secondary {
            background-color: ${EMAIL_PALETTE.neutralButton};
          }
          .button-secondary:hover {
            background-color: ${EMAIL_PALETTE.neutralButtonHover};
          }
          .footer {
            padding: 20px;
            font-size: 12px;
            color: ${EMAIL_PALETTE.textMuted};
            text-align: center;
            background-color: ${EMAIL_PALETTE.bgSecondary};
          }
          .overdue-badge {
            background-color: rgba(255, 255, 255, 0.2);
            color: white;
            padding: 6px 12px;
            border-radius: 6px;
            font-size: 12px;
            font-weight: bold;
            display: inline-block;
            margin-bottom: 8px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <!-- Header with task title -->
          <div class="header ${isOverdue ? '' : 'normal'}">
            ${isOverdue ? `<span class="overdue-badge">${h(t('email.reminder.overdueBadge'))}</span>` : ''}
            <h1 class="task-title">${escapeEmailHtml(data.title)}</h1>
            <p class="due-info">${h(t('email.due', { when: dueText }))}</p>
          </div>

          <!-- ${BRAND.appName} mascot with motivational quote -->
          <div class="astrid-section ${isOverdue ? '' : 'normal'}">
            <div class="astrid-container">
              <div class="astrid-icon">
                <img src="${baseUrl}${BRAND.icon}" alt="${BRAND.appName}" />
              </div>
              <div class="speech-bubble">
                <p class="quote-text">${quote}</p>
              </div>
            </div>
          </div>

          <!-- Task details -->
          <div class="task-details">
            ${data.listNames.length > 0 ? `
            <div class="detail-row">
              <div class="detail-label">${h(t('email.reminder.lists'))}</div>
              <div class="detail-value">${escapeEmailHtml(data.listNames.join(', '))}</div>
            </div>
            ` : ''}
            ${data.assigneeName ? `
            <div class="detail-row">
              <div class="detail-label">${h(t('email.reminder.assignedTo'))}</div>
              <div class="detail-value">${escapeEmailHtml(data.assigneeName)}</div>
            </div>
            ` : ''}
          </div>

          <!-- Collaborators section for shared lists -->
          ${isSharedList ? `
          <div class="collaborators-section">
            <div class="collaborators-title">${h(t('email.reminder.sharedList'))}</div>
            <div class="collaborators-avatars">
              ${(data.collaborators || []).slice(0, 5).map(collab => {
                const initials = collab.name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?'
                return `<div class="avatar">${escapeEmailHtml(initials)}</div>`
              }).join('')}
              ${(data.collaborators?.length || 0) > 5 ? `<div class="avatar">+${(data.collaborators?.length || 0) - 5}</div>` : ''}
            </div>
            <div class="collaborators-message">${h(t('email.reminder.countingOnYou'))}</div>
          </div>
          ` : ''}

          <!-- Action buttons -->
          <div class="actions">
            <a href="${this.getTaskUrl(data)}" class="button">
              ${h(isOverdue ? t('actions.viewOverdueTask') : t('actions.viewTask'))}
            </a>
            <a href="${this.getSnoozeUrl(data)}" class="button button-secondary">
              ${h(t('actions.snoozeReminder'))}
            </a>
          </div>

          <!-- Footer -->
          <div class="footer">
            <p>${h(footerWhy)}</p>
            <p>${h(t('email.reminder.footerPreferences'))}</p>
          </div>
        </div>
      </body>
      </html>
    `
  }

  private getTaskReminderText(data: TaskReminderData, copy: EmailCopy = englishCopy()): string {
    const { t } = copy
    const isOverdue = data.dueDateTime && new Date(data.dueDateTime) < new Date()
    const dueText = formatReminderDue(data.dueDateTime, isOverdue, copy)
    const lists = data.listNames.join(', ')

    return `
${isOverdue ? t('email.reminder.textHeadingOverdue') : t('email.reminder.textHeading')}

${t('email.reminder.textTask', { title: data.title })}
${data.listNames.length > 0 ? t('email.reminder.textLists', { lists }) : ''}
${t('email.due', { when: dueText })}
${data.assigneeName ? t('email.reminder.textAssignedTo', { name: data.assigneeName }) : ''}

${isOverdue ? t('email.reminder.textOverdueNote') : t('email.reminder.textDueSoonNote')}

${t('email.reminder.textViewTask', { url: this.getTaskUrl(data) })}
${t('email.reminder.textSnooze', { url: this.getSnoozeUrl(data) })}

---
${data.listNames.length > 0 ? t('email.reminder.footerWhyInLists', { lists }) : t('email.reminder.footerWhy')}
${t('email.reminder.footerPreferences')}
    `.trim()
  }

  private getDailyDigestHtml(data: DailyDigestData, copy: EmailCopy = englishCopy()): string {
    const { t } = copy
    const h = escapeEmailHtml
    const today = digestLongDate(new Date(), data.timeZone, copy.locale)
    const allTasks = [...data.overdueTasks, ...data.dueTodayTasks, ...data.dueTomorrowTasks]
    const baseUrl = getBaseUrl()

    const getPriorityColor = (task: TaskReminderData) =>
      data.overdueTasks.includes(task) ? tokenColor('overdue') : data.dueTodayTasks.includes(task) ? tokenColor('warning') : tokenColor('success')

    return `
      <!DOCTYPE html>
      <html lang="${copy.locale}">
      <head>
        <meta charset="utf-8">
        <title>${h(t('email.daily.pageTitle'))}</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: ${EMAIL_PALETTE.text};
            background-color: ${EMAIL_PALETTE.bgSecondary};
            margin: 0;
            padding: 20px;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            background-color: white;
            border-radius: 8px;
            overflow: hidden;
          }
          .header {
            background-color: white;
            padding: 24px 20px;
            border-bottom: 1px solid ${EMAIL_PALETTE.border};
          }
          .date-header {
            font-size: 20px;
            font-weight: 600;
            color: ${EMAIL_PALETTE.text};
            margin: 0 0 12px 0;
          }
          .greeting {
            font-size: 16px;
            color: ${EMAIL_PALETTE.textSecondary};
            margin: 8px 0;
          }
          .task-list {
            padding: 0;
          }
          .task-row {
            display: flex;
            align-items: flex-start;
            padding: 12px 20px;
            border-bottom: 1px solid ${EMAIL_PALETTE.border};
            text-decoration: none;
            transition: background-color 0.2s;
          }
          .task-row:hover {
            background-color: ${EMAIL_PALETTE.bgSecondary};
          }
          .task-checkbox {
            width: 20px;
            height: 20px;
            border: 2px solid;
            border-radius: 4px;
            margin-right: 12px;
            flex-shrink: 0;
            margin-top: 2px;
            display: inline-block;
          }
          .task-content {
            flex: 1;
            min-width: 0;
          }
          .task-title {
            font-size: 15px;
            color: ${EMAIL_PALETTE.text};
            font-weight: 500;
            word-wrap: break-word;
          }
          .task-meta {
            font-size: 13px;
            color: ${EMAIL_PALETTE.textMuted};
            margin-top: 4px;
          }
          .signature {
            padding: 20px;
            text-align: center;
            color: ${EMAIL_PALETTE.textMuted};
            font-size: 14px;
            border-bottom: 1px solid ${EMAIL_PALETTE.border};
          }
          .footer {
            padding: 20px;
            font-size: 13px;
            color: ${EMAIL_PALETTE.textMuted};
            line-height: 1.5;
            background-color: ${EMAIL_PALETTE.bgSecondary};
          }
          .footer-link {
            color: ${BRAND.accentColor};
            text-decoration: none;
          }
          .footer-link:hover {
            text-decoration: underline;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="date-header">${today}</div>
            <div class="greeting">${h(t('email.daily.greeting'))}</div>
            <div class="greeting">${h(t('email.daily.intro'))}</div>
          </div>

          <div class="task-list">
            ${allTasks.map(task => {
              const priorityColor = getPriorityColor(task)
              const taskUrl = this.getTaskUrl(task)
              return `
                <a href="${taskUrl}" class="task-row">
                  <span class="task-checkbox" style="border-color: ${priorityColor};"></span>
                  <div class="task-content">
                    <div class="task-title">${escapeEmailHtml(task.title)}</div>
                    ${task.listNames.length > 0 ? `<div class="task-meta">${escapeEmailHtml(task.listNames.join(', '))}</div>` : ''}
                  </div>
                </a>
              `
            }).join('')}
          </div>

          <div class="signature">
            ${h(t('email.daily.signature'))}
          </div>

          <div class="footer">
            ${h(t('email.daily.footerHint'))}<br>
            <a href="${getUnsubscribeUrl(data.userId)}" class="footer-link">${h(t('email.daily.unsubscribe'))}</a>.
          </div>
        </div>
      </body>
      </html>
    `
  }

  private getDailyDigestText(data: DailyDigestData, copy: EmailCopy = englishCopy()): string {
    const { t } = copy
    const today = digestLongDate(new Date(), data.timeZone, copy.locale)
    const allTasks = [...data.overdueTasks, ...data.dueTodayTasks, ...data.dueTomorrowTasks]

    let text = `${today}\n\n`
    text += `${t('email.daily.greeting')}\n\n`
    text += `${t('email.daily.intro')}\n\n`

    if (allTasks.length > 0) {
      text += `${t('email.daily.tasksHeading')}\n`
      text += `${allTasks.map(task => {
        const listInfo = task.listNames.length > 0 ? ` (${task.listNames.join(', ')})` : ''
        return `• ${task.title}${listInfo}\n  ${this.getTaskUrl(task)}`
      }).join('\n\n')}\n\n`
    }

    text += `${t('email.daily.signature')}\n\n`
    text += `---\n`
    text += `${t('email.daily.footerHint')}\n`
    text += t('email.daily.textUnsubscribe', { url: getUnsubscribeUrl(data.userId) })

    return text
  }

  private getWeeklyDigestHtml(data: {
    userName: string
    upcomingTasks: TaskReminderData[]
    timeZone?: string
  }, copy: EmailCopy = englishCopy()): string {
    const { t } = copy
    const h = escapeEmailHtml
    const weekRange = digestWeekRange(new Date(), data.timeZone, copy.locale)
    
    return `
      <!DOCTYPE html>
      <html lang="${copy.locale}">
      <head>
        <meta charset="utf-8">
        <title>${h(t('email.weekly.title'))}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: ${EMAIL_PALETTE.text}; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { text-align: center; padding: 20px 0; border-bottom: 2px solid ${BRAND.accentColor}; }
          .task-list { background-color: ${EMAIL_PALETTE.bgSecondary}; border-radius: 8px; padding: 16px; margin: 20px 0; }
          .task-item { padding: 12px 0; border-bottom: 1px solid ${EMAIL_PALETTE.border}; }
          .task-item:last-child { border-bottom: none; }
          .task-title { font-weight: bold; color: ${EMAIL_PALETTE.text}; }
          .task-meta { font-size: 14px; color: ${EMAIL_PALETTE.textMuted}; margin-top: 4px; }
          .footer { margin-top: 40px; font-size: 12px; color: ${EMAIL_PALETTE.textMuted}; text-align: center; }
          .button { background-color: ${BRAND.accentColor}; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>📅 ${h(t('email.weekly.title'))}</h1>
            <p>${h(data.userName ? t('email.weekly.helloNamed', { name: data.userName }) : t('email.weekly.hello'))} ${h(t('email.weekly.intro', { range: weekRange }))}</p>
          </div>

          <div class="task-list">
            <h2>🗓️ ${h(t('email.weekly.upcoming', { count: String(data.upcomingTasks.length) }))}</h2>
            ${data.upcomingTasks.map(task => `
              <div class="task-item">
                <div class="task-title">${escapeEmailHtml(task.title)}</div>
                <div class="task-meta">
                  ${h(t('email.due', { when: digestTaskDue(task, data.timeZone, copy) }))} •
                  ${h(t('email.weekly.lists', { lists: task.listNames.join(', ') }))}
                </div>
              </div>
            `).join('')}
          </div>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${this.getAppUrl()}" class="button">${h(t('actions.openTaskManager'))}</a>
          </div>

          <div class="footer">
            <p>${h(t('email.weekly.footerWhy'))}</p>
            <p>${h(t('email.weekly.footerPreferences'))}</p>
          </div>
        </div>
      </body>
      </html>
    `
  }

  private getWeeklyDigestText(data: {
    userName: string
    upcomingTasks: TaskReminderData[]
    timeZone?: string
  }, copy: EmailCopy = englishCopy()): string {
    const { t } = copy
    const weekRange = digestWeekRange(new Date(), data.timeZone, copy.locale)
    
    let text = `${t('email.weekly.textTitle', { range: weekRange })}\n\n`
    
    if (data.userName) {
      text += `${t('email.weekly.helloNamed', { name: data.userName })}\n\n`
    }

    text += `${t('email.weekly.textIntro')}\n\n`

    text += `${t('email.weekly.textUpcoming', { count: String(data.upcomingTasks.length) })}\n`
    text += `${data.upcomingTasks.map(task => 
      `• ${task.title} - ${t('email.due', { when: digestTaskDue(task, data.timeZone, copy) })} (${task.listNames.join(', ')})`
    ).join('\n')}\n\n`

    text += `${t('email.weekly.textOpen', { url: this.getAppUrl() })}\n\n`
    text += `---\n`
    text += `${t('email.weekly.footerWhy')}\n`
    text += t('email.weekly.footerPreferences')

    return text
  }

  private getTaskUrl(data: TaskReminderData | { taskId: string; listId?: string; shortcode?: string }): string {
    return buildTaskUrlWithContext(data.taskId, data.listId, data.shortcode)
  }

  private getSnoozeUrl(data: TaskReminderData | { taskId: string; listId?: string; shortcode?: string }): string {
    const taskUrl = buildTaskUrlWithContext(data.taskId, data.listId, data.shortcode)
    // Add action=snooze to the URL
    const separator = taskUrl.includes('?') ? '&' : '?'
    return `${taskUrl}${separator}action=snooze`
  }

  private getAppUrl(): string {
    return getBaseUrl()
  }
}