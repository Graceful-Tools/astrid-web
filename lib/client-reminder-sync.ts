// Client-side reminder synchronization service
// Manages syncing reminders between the main app and Service Worker

export interface ClientReminder {
  taskId: string
  title: string
  scheduledFor: Date | string
  type: 'due_reminder' | 'overdue_reminder'
  userId: string
  status: 'pending' | 'sent' | 'cancelled'
}

class ClientReminderSync {
  private serviceWorkerRegistration: ServiceWorkerRegistration | null = null

  constructor() {
    this.initialize()
  }

  private async initialize() {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.getRegistration()
        if (!registration) {
          // Wait for registration to complete
          this.serviceWorkerRegistration = await navigator.serviceWorker.ready
        } else {
          this.serviceWorkerRegistration = registration
        }
        log.info('Client Reminder Sync: Service Worker ready')
      } catch (error) {
        log.error({ err: error }, 'Client Reminder Sync: Failed to initialize Service Worker:')
      }
    }
  }

  // Send message to Service Worker
  private async sendMessageToSW(type: string, data?: any) {
    if (!this.serviceWorkerRegistration?.active) {
      log.warn({ type }, 'Client Reminder Sync: Service Worker not active, message not sent:')
      return
    }

    try {
      this.serviceWorkerRegistration.active.postMessage({
        type,
        data
      })
      log.info(`Client Reminder Sync: Sent message to SW: ${type}`)
    } catch (error) {
      log.error({ err: error }, 'Client Reminder Sync: Failed to send message to Service Worker:')
    }
  }

  // Schedule a single reminder in the Service Worker
  async scheduleReminder(reminder: ClientReminder) {
    await this.sendMessageToSW('SCHEDULE_REMINDER', reminder)
  }

  // Cancel a reminder in the Service Worker
  async cancelReminder(taskId: string) {
    await this.sendMessageToSW('CANCEL_REMINDER', { taskId })
  }

  // Sync all reminders with the Service Worker
  async syncAllReminders(reminders: ClientReminder[]) {
    await this.sendMessageToSW('SYNC_REMINDERS', { reminders })
  }

  // Fetch reminders from the server and sync with Service Worker
  async fetchAndSyncReminders(userId: string) {
    try {
      // v1's successor is /api/v1/reminders — the path changed name, not just
      // its prefix. Same { reminders, summary, total } keys plus meta, and this
      // reads only data.reminders. (641a7615 step 3)
      const response = await fetch('/api/v1/reminders', {
        headers: {
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch reminders: ${response.status}`)
      }

      const data = await response.json()
      const reminders: ClientReminder[] = data.reminders?.map((r: any) => ({
        taskId: r.taskId,
        title: r.data?.taskTitle || 'Untitled Task',
        scheduledFor: r.scheduledFor,
        type: r.type,
        userId: r.userId,
        status: r.status
      })) || []

      log.info(`Client Reminder Sync: Fetched ${reminders.length} reminders from server`)
      
      // Sync with Service Worker
      await this.syncAllReminders(reminders)
      
      return reminders
    } catch (error) {
      log.error({ err: error }, 'Client Reminder Sync: Failed to fetch and sync reminders:')
      return []
    }
  }

  // Schedule reminders for a task based on its due date
  async scheduleTaskReminders(task: any, userId: string) {
    if (!task.dueDateTime) {
      log.info('Client Reminder Sync: No due date, skipping reminder scheduling')
      return
    }

    const dueDate = new Date(task.dueDateTime)
    const now = new Date()
    
    if (dueDate <= now) {
      log.info('Client Reminder Sync: Due date is in the past, skipping reminder scheduling')
      return
    }

    const reminders: ClientReminder[] = []

    // Schedule reminder 15 minutes before due time
    const reminderTime = new Date(dueDate.getTime() - (15 * 60 * 1000))
    if (reminderTime > now) {
      reminders.push({
        taskId: task.id,
        title: task.title,
        scheduledFor: reminderTime,
        type: 'due_reminder',
        userId,
        status: 'pending'
      })
    } else if (dueDate > now) {
      // If less than 15 minutes until due, schedule for due time
      reminders.push({
        taskId: task.id,
        title: task.title,
        scheduledFor: dueDate,
        type: 'due_reminder',
        userId,
        status: 'pending'
      })
    }

    // Schedule overdue reminder (1 hour after due time)
    const overdueTime = new Date(dueDate.getTime() + (60 * 60 * 1000))
    reminders.push({
      taskId: task.id,
      title: task.title,
      scheduledFor: overdueTime,
      type: 'overdue_reminder',
      userId,
      status: 'pending'
    })

    // Schedule each reminder
    for (const reminder of reminders) {
      await this.scheduleReminder(reminder)
    }

    log.info(`Client Reminder Sync: Scheduled ${reminders.length} client-side reminders for task ${task.id}`)
  }

  // Cancel all reminders for a task
  async cancelTaskReminders(taskId: string) {
    await this.cancelReminder(taskId)
    log.info(`Client Reminder Sync: Cancelled client-side reminders for task ${taskId}`)
  }

  // Update reminders when a task changes
  async updateTaskReminders(task: any, userId: string) {
    // Cancel existing reminders
    await this.cancelTaskReminders(task.id)
    
    // Schedule new reminders if task is not completed
    if (!task.completed) {
      await this.scheduleTaskReminders(task, userId)
    }
  }
}

// Singleton instance
export const clientReminderSync = new ClientReminderSync()

// Hook for React components
import { useEffect } from 'react'
import { createLogger } from '@/lib/logger'

const log = createLogger('client-reminder-sync')


export function useClientReminderSync(userId: string) {
  useEffect(() => {
    // Initial sync when component mounts
    if (userId) {
      clientReminderSync.fetchAndSyncReminders(userId)
    }
  }, [userId])

  return {
    scheduleTaskReminders: (task: any) => clientReminderSync.scheduleTaskReminders(task, userId),
    cancelTaskReminders: (taskId: string) => clientReminderSync.cancelTaskReminders(taskId),
    updateTaskReminders: (task: any) => clientReminderSync.updateTaskReminders(task, userId),
    syncAllReminders: () => clientReminderSync.fetchAndSyncReminders(userId)
  }
}