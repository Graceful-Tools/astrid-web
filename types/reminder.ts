import type { User } from './task'

export interface ReminderSettings {
  id: string
  userId: string
  user?: User
  
  // Notification preferences
  enablePushReminders: boolean
  enableEmailReminders: boolean
  
  // Default reminder timing (minutes before due)
  defaultReminderTime: number // minutes before due date
  
  // Daily digest preferences
  enableDailyDigest: boolean
  dailyDigestTime: string // "HH:MM" format
  dailyDigestTimezone: string
  
  // Quiet hours
  quietHoursStart?: string | null // "22:00"
  quietHoursEnd?: string | null // "08:00"
  
  // Calendar integration
  enableCalendarSync: boolean
  calendarSyncType: string // "all", "with_due_times", "none"
  
  createdAt: Date
  updatedAt: Date
}

export interface ReminderQueue {
  id: string
  taskId: string
  userId: string
  scheduledFor: Date // When to send the reminder
  type: "due_reminder" | "daily_digest"
  status: "pending" | "sent" | "failed"
  retryCount: number
  data?: ReminderData // Additional data for the reminder
  
  createdAt: Date
  updatedAt: Date
}

export interface ReminderData {
  snoozeCount?: number
  snoozedAt?: Date
  originalScheduledFor?: Date
  rescheduledForQuietHours?: boolean
  lastError?: string
  lastAttempt?: Date
  [key: string]: unknown // Allow additional properties with type safety
}

export interface PushSubscription {
  id: string
  userId: string
  endpoint: string
  p256dh: string
  auth: string
  userAgent?: string | null
  isActive: boolean
  
  createdAt: Date
  updatedAt: Date
}

export interface ReminderSettingsForm {
  enablePushReminders: boolean
  enableEmailReminders: boolean
  defaultReminderTime: number // minutes before due
  enableDailyDigest: boolean
  dailyDigestTime: string
  dailyDigestTimezone: string
  quietHoursStart?: string
  quietHoursEnd?: string
}

export interface TaskReminderData {
  taskId: string
  title: string
  dueDateTime: Date
  assigneeEmail?: string
  assigneeName?: string
  listNames: string[]
  listId?: string
  shortcode?: string
  collaborators?: Array<{
    id: string
    name: string
    email: string
  }>
}

export interface DailyDigestData {
  userId: string
  userEmail: string
  userName: string
  dueTodayTasks: TaskReminderData[]
  dueTomorrowTasks: TaskReminderData[]
  overdueTasks: TaskReminderData[]
  upcomingTasks: TaskReminderData[]
}

export type ReminderPreferenceKey = 
  | 'enablePushReminders'
  | 'enableEmailReminders'
  | 'defaultReminderTime'
  | 'enableDailyDigest'
  | 'dailyDigestTime'
  | 'dailyDigestTimezone'
  | 'quietHoursStart'
  | 'quietHoursEnd'

export interface NotificationPermissionState {
  permission: NotificationPermission
  isSupported: boolean
  isServiceWorkerSupported: boolean
}

export interface PushNotificationPayload {
  title: string
  body: string
  data?: {
    taskId?: string
    commentId?: string
    channelId?: string
    messageId?: string
    action?: string
    url?: string
  }
  icon?: string
  badge?: string
  actions?: Array<{
    action: string
    title: string
    icon?: string
  }>
}