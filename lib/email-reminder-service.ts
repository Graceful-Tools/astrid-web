import type { TaskReminderData, DailyDigestData } from '@/types/reminder'
import { sendVerificationEmail, getFromEmail } from '@/lib/email'
import { Resend } from 'resend'
import { getRandomReminderString } from '@/lib/reminder-constants'
import { getBaseUrl, getUnsubscribeUrl, buildTaskUrlWithContext } from '@/lib/base-url'
import { createLogger } from '@/lib/logger'

const log = createLogger('email-reminder-service')


const resend = typeof window === 'undefined' && process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null

export class EmailReminderService {
  async sendTaskReminder(data: TaskReminderData): Promise<void> {
    const subject = this.getTaskReminderSubject(data)
    const htmlBody = this.getTaskReminderHtml(data)
    const textBody = this.getTaskReminderText(data)

    await this.sendEmail({
      to: data.assigneeEmail || '',
      subject,
      html: htmlBody,
      text: textBody,
    })
  }

  async sendDailyDigest(data: DailyDigestData): Promise<void> {
    const today = new Date().toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric'
    })
    const subject = `Reminders for ${today}`
    const htmlBody = this.getDailyDigestHtml(data)
    const textBody = this.getDailyDigestText(data)

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
  }): Promise<void> {
    const subject = `Weekly Task Outlook - ${this.getWeekRange()}`
    const htmlBody = this.getWeeklyDigestHtml(data)
    const textBody = this.getWeeklyDigestText(data)

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
    if (process.env.NODE_ENV === "development" || !resend || !process.env.RESEND_API_KEY) {
      log.info("📧 Reminder Email (Development Mode)")
      log.info({ to }, "To:")
      log.info({ subject }, "Subject:")
      log.info({ snippet: text.substring(0, 200) + "..." }, "Text")
      return
    }

    try {
      const { data: emailData, error } = await resend.emails.send({
        from: fromEmail,
        to: [to],
        subject,
        html,
        text,
      })

      if (error) {
        log.error({ err: error }, 'Resend error:')
        throw new Error(`Email sending failed: ${error.message}`)
      }

      log.info({ id: emailData?.id, to }, '📧 Reminder email sent successfully:')
    } catch (error) {
      log.error({ err: error }, 'Error sending reminder email:')
      throw error
    }
  }

  private getTaskReminderSubject(data: TaskReminderData): string {
    const isOverdue = data.dueDateTime && new Date(data.dueDateTime) < new Date()
    
    if (isOverdue) {
      return `⚠️ Overdue: ${data.title}`
    }

    const timeUntilDue = this.getTimeUntilDue(data.dueDateTime)
    return `⏰ Reminder: ${data.title}${timeUntilDue ? ` (due ${timeUntilDue})` : ''}`
  }

  private getTaskReminderHtml(data: TaskReminderData): string {
    const isOverdue = data.dueDateTime && new Date(data.dueDateTime) < new Date()
    const dueText = this.formatDueDate(data.dueDateTime, isOverdue)
    const listText = data.listNames.length > 0 ? ` in ${data.listNames.join(', ')}` : ''
    const quote = isOverdue
      ? getRandomReminderString('reminders_due')
      : getRandomReminderString('reminder_responses')
    const baseUrl = this.getAppUrl()
    const isSharedList = (data.collaborators?.length || 0) > 0

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Task Reminder</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #1f2937;
            background-color: #f9fafb;
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
            background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
            padding: 30px 20px;
            text-align: center;
          }
          .header.normal {
            background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
          }
          .astrid-section {
            padding: 40px 20px;
            text-align: center;
            background-color: #fef2f2;
            position: relative;
          }
          .astrid-section.normal {
            background-color: #eff6ff;
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
            border: 3px solid #1f2937;
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
            border-right: 20px solid #1f2937;
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
            color: #1f2937;
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
            border-bottom: 1px solid #e5e7eb;
          }
          .detail-row:last-child {
            border-bottom: none;
          }
          .detail-label {
            font-weight: 600;
            color: #6b7280;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 4px;
          }
          .detail-value {
            color: #1f2937;
            font-size: 16px;
          }
          .collaborators-section {
            background-color: #fef3c7;
            padding: 20px;
            margin: 20px;
            border-radius: 12px;
            text-align: center;
          }
          .collaborators-title {
            font-size: 14px;
            font-weight: 600;
            color: #92400e;
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
            background-color: #3b82f6;
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
            color: #92400e;
          }
          .actions {
            text-align: center;
            padding: 30px 20px;
            background-color: #f9fafb;
          }
          .button {
            background-color: ${isOverdue ? '#ef4444' : '#3b82f6'};
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
            background-color: ${isOverdue ? '#dc2626' : '#2563eb'};
          }
          .button-secondary {
            background-color: #6b7280;
          }
          .button-secondary:hover {
            background-color: #4b5563;
          }
          .footer {
            padding: 20px;
            font-size: 12px;
            color: #6b7280;
            text-align: center;
            background-color: #f9fafb;
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
            ${isOverdue ? '<span class="overdue-badge">⚠️ OVERDUE</span>' : ''}
            <h1 class="task-title">${data.title}</h1>
            <p class="due-info">Due: ${dueText}</p>
          </div>

          <!-- Astrid mascot with motivational quote -->
          <div class="astrid-section ${isOverdue ? '' : 'normal'}">
            <div class="astrid-container">
              <div class="astrid-icon">
                <img src="${baseUrl}/icons/icon-512x512.png" alt="Astrid" />
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
              <div class="detail-label">Lists</div>
              <div class="detail-value">${data.listNames.join(', ')}</div>
            </div>
            ` : ''}
            ${data.assigneeName ? `
            <div class="detail-row">
              <div class="detail-label">Assigned To</div>
              <div class="detail-value">${data.assigneeName}</div>
            </div>
            ` : ''}
          </div>

          <!-- Collaborators section for shared lists -->
          ${isSharedList ? `
          <div class="collaborators-section">
            <div class="collaborators-title">SHARED LIST</div>
            <div class="collaborators-avatars">
              ${(data.collaborators || []).slice(0, 5).map(collab => {
                const initials = collab.name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?'
                return `<div class="avatar">${initials}</div>`
              }).join('')}
              ${(data.collaborators?.length || 0) > 5 ? `<div class="avatar">+${(data.collaborators?.length || 0) - 5}</div>` : ''}
            </div>
            <div class="collaborators-message">These people are counting on you! 🤝</div>
          </div>
          ` : ''}

          <!-- Action buttons -->
          <div class="actions">
            <a href="${this.getTaskUrl(data)}" class="button">
              ${isOverdue ? 'View Overdue Task' : 'View Task'}
            </a>
            <a href="${this.getSnoozeUrl(data)}" class="button button-secondary">
              Snooze Reminder
            </a>
          </div>

          <!-- Footer -->
          <div class="footer">
            <p>This reminder was sent because you have a task due${listText}.</p>
            <p>You can modify your reminder preferences in your settings.</p>
          </div>
        </div>
      </body>
      </html>
    `
  }

  private getTaskReminderText(data: TaskReminderData): string {
    const isOverdue = data.dueDateTime && new Date(data.dueDateTime) < new Date()
    const dueText = this.formatDueDate(data.dueDateTime, isOverdue)
    const listText = data.listNames.length > 0 ? ` in ${data.listNames.join(', ')}` : ''

    return `
${isOverdue ? '⚠️ TASK OVERDUE' : '⏰ TASK REMINDER'}

Task: ${data.title}
${data.listNames.length > 0 ? `Lists: ${data.listNames.join(', ')}` : ''}
Due: ${dueText}
${data.assigneeName ? `Assigned to: ${data.assigneeName}` : ''}

${isOverdue ? 'This task is overdue and needs your attention.' : 'This task is due soon.'}

View task: ${this.getTaskUrl(data)}
Snooze reminder: ${this.getSnoozeUrl(data)}

---
This reminder was sent because you have a task due${listText}.
You can modify your reminder preferences in your account settings.
    `.trim()
  }

  private getDailyDigestHtml(data: DailyDigestData): string {
    const today = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
    const allTasks = [...data.overdueTasks, ...data.dueTodayTasks, ...data.dueTomorrowTasks]
    const baseUrl = getBaseUrl()

    const getPriorityColor = (task: TaskReminderData) => {
      if (data.overdueTasks.includes(task)) return '#ef4444'
      if (data.dueTodayTasks.includes(task)) return '#f59e0b'
      return '#10b981'
    }

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Daily Task Digest</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #1f2937;
            background-color: #f9fafb;
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
            border-bottom: 1px solid #e5e7eb;
          }
          .date-header {
            font-size: 20px;
            font-weight: 600;
            color: #1f2937;
            margin: 0 0 12px 0;
          }
          .greeting {
            font-size: 16px;
            color: #4b5563;
            margin: 8px 0;
          }
          .task-list {
            padding: 0;
          }
          .task-row {
            display: flex;
            align-items: flex-start;
            padding: 12px 20px;
            border-bottom: 1px solid #e5e7eb;
            text-decoration: none;
            transition: background-color 0.2s;
          }
          .task-row:hover {
            background-color: #f9fafb;
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
            color: #1f2937;
            font-weight: 500;
            word-wrap: break-word;
          }
          .task-meta {
            font-size: 13px;
            color: #6b7280;
            margin-top: 4px;
          }
          .signature {
            padding: 20px;
            text-align: center;
            color: #6b7280;
            font-size: 14px;
            border-bottom: 1px solid #e5e7eb;
          }
          .footer {
            padding: 20px;
            font-size: 13px;
            color: #6b7280;
            line-height: 1.5;
            background-color: #f9fafb;
          }
          .footer-link {
            color: #3b82f6;
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
            <div class="greeting">Astrid here,</div>
            <div class="greeting">Reminding you about the things that are important to you.</div>
          </div>

          <div class="task-list">
            ${allTasks.map(task => {
              const priorityColor = getPriorityColor(task)
              const taskUrl = this.getTaskUrl(task)
              return `
                <a href="${taskUrl}" class="task-row">
                  <span class="task-checkbox" style="border-color: ${priorityColor};"></span>
                  <div class="task-content">
                    <div class="task-title">${task.title}</div>
                    ${task.listNames.length > 0 ? `<div class="task-meta">${task.listNames.join(', ')}</div>` : ''}
                  </div>
                </a>
              `
            }).join('')}
          </div>

          <div class="signature">
            - Astrid
          </div>

          <div class="footer">
            Click on checkboxes to mark task as complete or task name to view / edit.<br>
            <a href="${getUnsubscribeUrl(data.userId)}" class="footer-link">Unsubscribe from email reminders</a>.
          </div>
        </div>
      </body>
      </html>
    `
  }

  private getDailyDigestText(data: DailyDigestData): string {
    const today = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
    const allTasks = [...data.overdueTasks, ...data.dueTodayTasks, ...data.dueTomorrowTasks]

    let text = `${today}\n\n`
    text += `Astrid here,\n\n`
    text += `Reminding you about the things that are important to you.\n\n`

    if (allTasks.length > 0) {
      text += `TASKS\n`
      text += `${allTasks.map(task => {
        const listInfo = task.listNames.length > 0 ? ` (${task.listNames.join(', ')})` : ''
        return `• ${task.title}${listInfo}\n  ${this.getTaskUrl(task)}`
      }).join('\n\n')}\n\n`
    }

    text += `- Astrid\n\n`
    text += `---\n`
    text += `Click on checkboxes to mark task as complete or task name to view / edit.\n`
    text += `Unsubscribe from email reminders: ${getUnsubscribeUrl(data.userId)}`

    return text
  }

  private getWeeklyDigestHtml(data: {
    userName: string
    upcomingTasks: TaskReminderData[]
  }): string {
    const weekRange = this.getWeekRange()
    
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Weekly Task Outlook</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { text-align: center; padding: 20px 0; border-bottom: 2px solid #3b82f6; }
          .task-list { background-color: #f9fafb; border-radius: 8px; padding: 16px; margin: 20px 0; }
          .task-item { padding: 12px 0; border-bottom: 1px solid #e5e7eb; }
          .task-item:last-child { border-bottom: none; }
          .task-title { font-weight: bold; color: #1f2937; }
          .task-meta { font-size: 14px; color: #6b7280; margin-top: 4px; }
          .footer { margin-top: 40px; font-size: 12px; color: #6b7280; text-align: center; }
          .button { background-color: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>📅 Weekly Task Outlook</h1>
            <p>Hello${data.userName ? ` ${data.userName}` : ''}! Here are your upcoming tasks for ${weekRange}</p>
          </div>

          <div class="task-list">
            <h2>🗓️ Upcoming Tasks (${data.upcomingTasks.length})</h2>
            ${data.upcomingTasks.map(task => `
              <div class="task-item">
                <div class="task-title">${task.title}</div>
                <div class="task-meta">
                  Due: ${this.formatDueDate(task.dueDateTime)} • 
                  Lists: ${task.listNames.join(', ')}
                </div>
              </div>
            `).join('')}
          </div>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${this.getAppUrl()}" class="button">Open Task Manager</a>
          </div>

          <div class="footer">
            <p>You're receiving this weekly outlook to help you plan your week ahead.</p>
            <p>You can adjust your digest preferences in your account settings.</p>
          </div>
        </div>
      </body>
      </html>
    `
  }

  private getWeeklyDigestText(data: {
    userName: string
    upcomingTasks: TaskReminderData[]
  }): string {
    const weekRange = this.getWeekRange()
    
    let text = `📅 WEEKLY TASK OUTLOOK - ${weekRange}\n\n`
    
    if (data.userName) {
      text += `Hello ${data.userName}!\n\n`
    }

    text += `Here are your upcoming tasks for this week:\n\n`

    text += `🗓️ UPCOMING TASKS (${data.upcomingTasks.length})\n`
    text += `${data.upcomingTasks.map(task => 
      `• ${task.title} - Due: ${this.formatDueDate(task.dueDateTime)} (${task.listNames.join(', ')})`
    ).join('\n')}\n\n`

    text += `Open Task Manager: ${this.getAppUrl()}\n\n`
    text += `---\n`
    text += `You're receiving this weekly outlook to help you plan your week ahead.\n`
    text += `You can adjust your digest preferences in your account settings.`

    return text
  }

  private formatDueDate(dueDateTime: Date | null, isOverdue = false): string {
    if (!dueDateTime) return 'No due date'

    const due = new Date(dueDateTime)
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const dueDate = new Date(due.getFullYear(), due.getMonth(), due.getDate())

    const diffTime = dueDate.getTime() - today.getTime()
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

    const timeString = due.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    })

    const dateString = due.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    })

    if (isOverdue) {
      return `${dateString} at ${timeString} (${Math.abs(diffDays)} days overdue)`
    } else if (diffDays === 0) {
      return `Today at ${timeString}`
    } else if (diffDays === 1) {
      return `Tomorrow at ${timeString}`
    } else if (diffDays === -1) {
      return `Yesterday at ${timeString}`
    } else if (diffDays < 7) {
      return `${dateString} at ${timeString}`
    } else {
      return `${dateString} at ${timeString}`
    }
  }

  private getTimeUntilDue(dueDateTime: Date | null): string | null {
    if (!dueDateTime) return null

    const due = new Date(dueDateTime)
    const now = new Date()
    const diffMs = due.getTime() - now.getTime()
    
    if (diffMs <= 0) return null

    const diffMinutes = Math.floor(diffMs / (1000 * 60))
    const diffHours = Math.floor(diffMinutes / 60)
    const diffDays = Math.floor(diffHours / 24)

    if (diffDays > 0) {
      return `in ${diffDays} day${diffDays !== 1 ? 's' : ''}`
    } else if (diffHours > 0) {
      return `in ${diffHours} hour${diffHours !== 1 ? 's' : ''}`
    } else if (diffMinutes > 0) {
      return `in ${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''}`
    } else {
      return 'now'
    }
  }

  private getWeekRange(): string {
    const now = new Date()
    const startOfWeek = new Date(now)
    startOfWeek.setDate(now.getDate() - now.getDay()) // Sunday
    
    const endOfWeek = new Date(startOfWeek)
    endOfWeek.setDate(startOfWeek.getDate() + 6) // Saturday

    const startString = startOfWeek.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    const endString = endOfWeek.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    
    return `${startString} - ${endString}`
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