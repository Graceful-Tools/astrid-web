// Reminder Management System
// Handles scheduling, triggering, and managing task reminders

import { Task, User } from "@/types/task"

export interface ReminderConfig {
  taskId: string
  userId: string
  scheduledFor: Date
  type: "due_reminder" | "random_reminder" | "overdue_reminder"
  isActive: boolean
  snoozedUntil?: Date
}

export interface ActiveReminder {
  id: string
  task: Task
  config: ReminderConfig
  showTime: Date
}

class ReminderManager {
  private reminders: Map<string, ReminderConfig> = new Map()
  private activeReminders: Map<string, ActiveReminder> = new Map()
  private checkInterval: NodeJS.Timeout | null = null
  private listeners: Array<(reminders: ActiveReminder[]) => void> = []

  constructor() {
    this.startReminderCheck()
  }

  // Add a listener for reminder changes
  addListener(callback: (reminders: ActiveReminder[]) => void) {
    this.listeners.push(callback)
  }

  // Remove a listener
  removeListener(callback: (reminders: ActiveReminder[]) => void) {
    this.listeners = this.listeners.filter(l => l !== callback)
  }

  // Notify all listeners
  private notifyListeners() {
    const activeList = Array.from(this.activeReminders.values())
    this.listeners.forEach(callback => callback(activeList))
  }

  // Schedule a reminder for a task
  scheduleReminder(task: Task, type: ReminderConfig["type"], scheduledFor: Date, userId: string) {
    const reminderId = `${task.id}_${type}_${scheduledFor.getTime()}`
    
    // Check if this exact reminder already exists
    if (this.reminders.has(reminderId)) {
      return // Don't schedule duplicate reminders
    }
    
    const config: ReminderConfig = {
      taskId: task.id,
      userId,
      scheduledFor,
      type,
      isActive: true
    }

    this.reminders.set(reminderId, config)
    log.info(`📅 Scheduled ${type} reminder for task "${task.title}" at ${scheduledFor.toLocaleString()}`)
  }

  // Schedule reminders based on task due date
  scheduleTaskReminders(task: Task, userId: string) {
    if (!task.dueDateTime) return // No due date, no reminders

    const dueDate = new Date(task.dueDateTime)
    const now = new Date()

    // Only schedule reminders for future due dates
    if (dueDate <= now) return

    // Schedule due reminder (15 minutes before due time, or at due time if less than 15 minutes)
    const reminderTime = new Date(dueDate.getTime() - (15 * 60 * 1000)) // 15 minutes before
    if (reminderTime > now) {
      this.scheduleReminder(task, "due_reminder", reminderTime, userId)
    } else if (dueDate > now) {
      // If less than 15 minutes, schedule for due time
      this.scheduleReminder(task, "due_reminder", dueDate, userId)
    }

    // Schedule overdue reminder (1 hour after due time)
    const overdueTime = new Date(dueDate.getTime() + (60 * 60 * 1000)) // 1 hour after
    this.scheduleReminder(task, "overdue_reminder", overdueTime, userId)

    // Don't schedule random reminders - they're not needed and cause spam
  }

  // Remove all reminders for a task
  removeTaskReminders(taskId: string) {
    const toRemove = Array.from(this.reminders.entries())
      .filter(([_, config]) => config.taskId === taskId)
      .map(([id]) => id)

    toRemove.forEach(id => {
      this.reminders.delete(id)
      this.activeReminders.delete(id)
    })

    if (toRemove.length > 0) {
      this.notifyListeners()
    }
  }

  // Snooze a reminder
  snoozeReminder(reminderId: string, minutes: number) {
    const reminder = this.activeReminders.get(reminderId)
    if (!reminder) return

    const snoozeUntil = new Date(Date.now() + (minutes * 60 * 1000))
    reminder.config.snoozedUntil = snoozeUntil
    
    // Remove from active reminders temporarily
    this.activeReminders.delete(reminderId)
    this.notifyListeners()

    log.info(`😴 Snoozed reminder for "${reminder.task.title}" until ${snoozeUntil.toLocaleString()}`)
  }

  // Dismiss a reminder permanently
  dismissReminder(reminderId: string) {
    const reminder = this.activeReminders.get(reminderId)
    if (!reminder) return

    reminder.config.isActive = false
    this.activeReminders.delete(reminderId)
    this.notifyListeners()

    log.info(`❌ Dismissed reminder for "${reminder.task.title}"`)
  }

  // Mark task as complete and remove all reminders
  completeTask(taskId: string) {
    this.removeTaskReminders(taskId)
    log.info(`✅ Completed task and removed all reminders for task ${taskId}`)
  }

  // Get all active reminders for a user
  getActiveReminders(userId: string): ActiveReminder[] {
    return Array.from(this.activeReminders.values())
      .filter(reminder => reminder.config.userId === userId)
  }

  // Check for reminders that should be shown
  private checkReminders = () => {
    const now = new Date()
    let hasChanges = false

    for (const [reminderId, config] of this.reminders.entries()) {
      if (!config.isActive) continue

      // Check if reminder is snoozed
      if (config.snoozedUntil && config.snoozedUntil > now) continue

      // Check if it's time to show this reminder
      if (config.scheduledFor <= now && !this.activeReminders.has(reminderId)) {
        // We need the full task object to create an active reminder
        // In a real implementation, you'd fetch this from your task store/database
        // For now, we'll skip creating the active reminder since we don't have the full task
        // This will be handled by the triggerManualReminder function instead
        log.info(`🔔 Triggered ${config.type} reminder for task ${config.taskId} (task data needed)`)
      }
    }

    if (hasChanges) {
      this.notifyListeners()
    }
  }

  // Start the reminder checking interval
  private startReminderCheck() {
    // Check every minute
    this.checkInterval = setInterval(this.checkReminders, 60 * 1000)
    
    // Also check immediately
    this.checkReminders()
  }

  // Stop the reminder checking
  stopReminderCheck() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = null
    }
  }

  // Update a task and reschedule its reminders
  updateTaskReminders(task: Task, userId: string) {
    // Remove existing reminders
    this.removeTaskReminders(task.id)
    
    // Only schedule new reminders if task is not completed
    if (!task.completed) {
      this.scheduleTaskReminders(task, userId)
    }
  }

  // Clear all reminders (for testing purposes)
  clearAllReminders() {
    this.reminders.clear()
    this.activeReminders.clear()
    this.notifyListeners()
  }

  // Manual trigger for debug mode - immediately show a reminder for a task
  triggerManualReminder(task: Task, userId: string) {
    const reminderId = `manual_${task.id}_${Date.now()}`
    const now = new Date()

    const config: ReminderConfig = {
      taskId: task.id,
      userId,
      scheduledFor: now,
      type: "due_reminder", // Use due reminder type for manual triggers
      isActive: true
    }

    // Create the active reminder immediately
    const activeReminder: ActiveReminder = {
      id: reminderId,
      task,
      config,
      showTime: now
    }

    // Add to active reminders
    this.activeReminders.set(reminderId, activeReminder)
    this.notifyListeners()

    log.info(`🔔 [DEBUG] Manual reminder triggered for task "${task.title}"`)
    
    return reminderId
  }
}

// Singleton instance
export const reminderManager = new ReminderManager()

// Import React for the hook
import { useState, useEffect } from "react"
import { createLogger } from '@/lib/logger'

const log = createLogger('reminder-manager')


// Hook for React components to use reminders
export function useReminders(userId: string) {
  const [activeReminders, setActiveReminders] = useState<ActiveReminder[]>([])

  useEffect(() => {
    const updateReminders = (reminders: ActiveReminder[]) => {
      setActiveReminders(reminders.filter(r => r.config.userId === userId))
    }

    reminderManager.addListener(updateReminders)
    
    // Get initial reminders
    updateReminders(reminderManager.getActiveReminders(userId))

    return () => {
      reminderManager.removeListener(updateReminders)
    }
  }, [userId])

  return {
    activeReminders,
    snoozeReminder: (reminderId: string, minutes: number) => reminderManager.snoozeReminder(reminderId, minutes),
    dismissReminder: (reminderId: string) => reminderManager.dismissReminder(reminderId),
    completeTask: (taskId: string) => reminderManager.completeTask(taskId),
    scheduleTaskReminders: (task: Task) => reminderManager.scheduleTaskReminders(task, userId),
    updateTaskReminders: (task: Task) => reminderManager.updateTaskReminders(task, userId),
    triggerManualReminder: (task: Task) => reminderManager.triggerManualReminder(task, userId)
  }
}

