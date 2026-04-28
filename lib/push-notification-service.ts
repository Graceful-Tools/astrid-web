import webpush from 'web-push'
import { prisma as defaultPrisma } from '@/lib/prisma'
import { decryptField } from '@/lib/field-encryption'
import type { PushNotificationPayload } from '@/types/reminder'
import type { PrismaClient } from '@prisma/client'
import { createLogger } from '@/lib/logger'

const log = createLogger('push-notification-service')


// Configure web-push with VAPID keys
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:noreply@astrid.app',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  )
}

export class PushNotificationService {
  private prisma: PrismaClient

  constructor(customPrisma?: PrismaClient) {
    this.prisma = customPrisma || defaultPrisma
  }

  async sendNotification(userId: string, payload: PushNotificationPayload): Promise<void> {
    try {
      // Get active push subscriptions for user
      const subscriptions = await this.prisma.pushSubscription.findMany({
        where: {
          userId,
          isActive: true,
        },
      })

      if (subscriptions.length === 0) {
        log.info(`No active push subscriptions found for user ${userId}`)
        return
      }

      const promises = subscriptions.map(subscription => 
        this.sendToSubscription(subscription, payload)
      )

      await Promise.allSettled(promises)
    } catch (error) {
      log.error({ err: error }, 'Error sending push notifications:')
      throw error
    }
  }

  private async sendToSubscription(subscription: any, payload: PushNotificationPayload): Promise<void> {
    try {
      // Decrypt the encrypted keys before use
      const p256dh = decryptField(subscription.p256dh)
      const auth = decryptField(subscription.auth)

      if (!p256dh || !auth) {
        log.error(`Missing decrypted keys for subscription ${subscription.id}`)
        return
      }

      const pushSubscription = {
        endpoint: subscription.endpoint,
        keys: {
          p256dh,
          auth,
        },
      }

      await webpush.sendNotification(
        pushSubscription,
        JSON.stringify(payload),
        {
          TTL: 24 * 60 * 60, // 24 hours
          urgency: 'normal',
        }
      )

      log.info(`Push notification sent successfully to subscription ${subscription.id}`)
    } catch (error: any) {
      log.error({ err: error }, `Failed to send push notification to subscription ${subscription.id}:`)

      // Handle subscription errors
      if (error.statusCode === 410 || error.statusCode === 404) {
        // Subscription is no longer valid, deactivate it
        await this.prisma.pushSubscription.update({
          where: { id: subscription.id },
          data: { isActive: false },
        })
        log.info(`Deactivated invalid push subscription ${subscription.id}`)
      }

      throw error
    }
  }

  async sendTaskReminder(userId: string, taskData: {
    taskId: string
    title: string
    dueDateTime?: Date | null
    isOverdue?: boolean
  }): Promise<void> {
    const { taskId, title, dueDateTime, isOverdue } = taskData

    let notificationTitle = 'Task Reminder'
    let notificationBody = `${title}`

    if (isOverdue) {
      notificationTitle = 'Task Overdue'
      notificationBody = `${title} is overdue`
    } else if (dueDateTime) {
      const timeUntilDue = this.getTimeUntilDue(dueDateTime)
      if (timeUntilDue) {
        notificationBody = `${title} is due ${timeUntilDue}`
      } else {
        notificationBody = `${title} is due now`
      }
    }

    const payload: PushNotificationPayload = {
      title: notificationTitle,
      body: notificationBody,
      data: {
        taskId,
        action: 'task_reminder',
        url: `/tasks/${taskId}`,
      },
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-72x72.png',
      actions: [
        {
          action: 'open',
          title: 'View Task',
        },
        {
          action: 'snooze_15',
          title: 'Snooze 15min',
        },
        {
          action: 'complete',
          title: 'Mark Complete',
        },
      ],
    }

    await this.sendNotification(userId, payload)
  }

  async sendDailyDigest(userId: string, digestData: {
    totalTasks: number
    overdueTasks: number
    dueTodayTasks: number
    dueTomorrowTasks: number
  }): Promise<void> {
    const { totalTasks, overdueTasks, dueTodayTasks, dueTomorrowTasks } = digestData

    if (totalTasks === 0) {
      return // Don't send notification if no tasks
    }

    let title = '📅 Daily Task Digest'
    let body = `${totalTasks} tasks need attention`

    if (overdueTasks > 0) {
      title = '⚠️ Tasks Need Attention'
      body = `${overdueTasks} overdue, ${dueTodayTasks} due today`
    } else if (dueTodayTasks > 0) {
      body = `${dueTodayTasks} due today, ${dueTomorrowTasks} due tomorrow`
    }

    const payload: PushNotificationPayload = {
      title,
      body,
      data: {
        action: 'daily_digest',
        url: '/',
      },
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-72x72.png',
      actions: [
        {
          action: 'open',
          title: 'View Tasks',
        },
        {
          action: 'dismiss',
          title: 'Dismiss',
        },
      ],
    }

    await this.sendNotification(userId, payload)
  }

  async sendCommentNotification(userId: string, data: {
    taskId: string
    commentId: string
    taskTitle: string
    commenterName: string
    content: string
    type: 'mention' | 'assignment'
  }): Promise<void> {
    const { taskId, taskTitle, commenterName, content, type } = data

    let title = ''
    let body = ''

    if (type === 'mention') {
      title = `${commenterName} mentioned you`
      body = `"${content.substring(0, 50)}${content.length > 50 ? '...' : ''}" in ${taskTitle}`
    } else {
      title = `New comment on your task`
      body = `${commenterName}: "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`
    }

    const payload: PushNotificationPayload = {
      title,
      body,
      data: {
        taskId,
        commentId: data.commentId,
        action: 'comment',
        url: `/tasks/${taskId}#comment-${data.commentId}`,
      },
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-72x72.png',
    }

    await this.sendNotification(userId, payload)
  }

  async sendChatMentionNotification(userId: string, data: {
    channelId: string
    messageId: string
    senderName: string
    content: string
  }): Promise<void> {
    const { channelId, messageId, senderName, content } = data

    // Strip reference markup for display: @[Name](id) → @Name
    const cleanContent = content
      .replace(/@\[([^\]]+)\]\([^)]+\)/g, '@$1')
      .replace(/#\[([^\]]+)\]\([^)]+\)/g, '#$1')
      .replace(/!\[([^\]]+)\]\([^)]+\)/g, '!$1')

    const payload: PushNotificationPayload = {
      title: `${senderName} mentioned you in chat`,
      body: `"${cleanContent.substring(0, 80)}${cleanContent.length > 80 ? '...' : ''}"`,
      data: {
        channelId,
        messageId,
        action: 'chat_mention',
        url: '/',
      },
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-72x72.png',
    }

    await this.sendNotification(userId, payload)
  }

  private getTimeUntilDue(dueDateTime: Date): string | null {
    const due = new Date(dueDateTime)
    const now = new Date()
    const diffMs = due.getTime() - now.getTime()
    
    if (diffMs <= 0) return 'now'

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

  // For testing - send a test notification
  async sendTestNotification(userId: string): Promise<void> {
    const payload: PushNotificationPayload = {
      title: 'Test Notification',
      body: 'This is a test notification from Astrid',
      data: {
        action: 'test',
        url: '/',
      },
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-72x72.png',
    }

    await this.sendNotification(userId, payload)
  }
}