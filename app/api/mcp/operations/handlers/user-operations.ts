/**
 * User settings operations for MCP API
 */

import { prisma } from "@/lib/prisma"
import { resolveMCPActor } from "./shared"

export async function getUserSettings(accessToken: string, userId: string) {
  const mcpToken = await resolveMCPActor(accessToken, userId)

  // Get or create reminder settings for user
  let reminderSettings = await prisma.reminderSettings.findUnique({
    where: { userId: mcpToken.userId }
  })

  if (!reminderSettings) {
    // Create default settings if none exist
    reminderSettings = await prisma.reminderSettings.create({
      data: {
        userId: mcpToken.userId,
        enablePushReminders: true,
        enableEmailReminders: true,
        defaultReminderTime: 60, // 1 hour before
        enableDailyDigest: true,
        dailyDigestTime: "09:00",
        dailyDigestTimezone: "UTC",
        enableCalendarSync: false,
        calendarSyncType: "all",
      }
    })
  }

  return {
    success: true,
    settings: {
      reminderSettings: {
        enablePushReminders: reminderSettings.enablePushReminders,
        enableEmailReminders: reminderSettings.enableEmailReminders,
        defaultReminderTime: reminderSettings.defaultReminderTime,
        enableDailyDigest: reminderSettings.enableDailyDigest,
        dailyDigestTime: reminderSettings.dailyDigestTime,
        dailyDigestTimezone: reminderSettings.dailyDigestTimezone,
        quietHoursStart: reminderSettings.quietHoursStart,
        quietHoursEnd: reminderSettings.quietHoursEnd,
        enableCalendarSync: reminderSettings.enableCalendarSync,
        calendarSyncType: reminderSettings.calendarSyncType,
      }
    }
  }
}

export async function updateUserSettings(accessToken: string, settings: any, userId: string) {
  const mcpToken = await resolveMCPActor(accessToken, userId)

  const updates: any = {}

  // Update reminder settings if provided
  if (settings.reminderSettings) {
    const reminderSettings = await prisma.reminderSettings.upsert({
      where: { userId: mcpToken.userId },
      update: {
        ...(settings.reminderSettings.enablePushReminders !== undefined && {
          enablePushReminders: settings.reminderSettings.enablePushReminders
        }),
        ...(settings.reminderSettings.enableEmailReminders !== undefined && {
          enableEmailReminders: settings.reminderSettings.enableEmailReminders
        }),
        ...(settings.reminderSettings.defaultReminderTime !== undefined && {
          defaultReminderTime: settings.reminderSettings.defaultReminderTime
        }),
        ...(settings.reminderSettings.enableDailyDigest !== undefined && {
          enableDailyDigest: settings.reminderSettings.enableDailyDigest
        }),
        ...(settings.reminderSettings.dailyDigestTime !== undefined && {
          dailyDigestTime: settings.reminderSettings.dailyDigestTime
        }),
        ...(settings.reminderSettings.dailyDigestTimezone !== undefined && {
          dailyDigestTimezone: settings.reminderSettings.dailyDigestTimezone
        }),
        ...(settings.reminderSettings.quietHoursStart !== undefined && {
          quietHoursStart: settings.reminderSettings.quietHoursStart
        }),
        ...(settings.reminderSettings.quietHoursEnd !== undefined && {
          quietHoursEnd: settings.reminderSettings.quietHoursEnd
        }),
        ...(settings.reminderSettings.enableCalendarSync !== undefined && {
          enableCalendarSync: settings.reminderSettings.enableCalendarSync
        }),
        ...(settings.reminderSettings.calendarSyncType !== undefined && {
          calendarSyncType: settings.reminderSettings.calendarSyncType
        }),
        updatedAt: new Date(),
      },
      create: {
        userId: mcpToken.userId,
        enablePushReminders: settings.reminderSettings.enablePushReminders ?? true,
        enableEmailReminders: settings.reminderSettings.enableEmailReminders ?? true,
        defaultReminderTime: settings.reminderSettings.defaultReminderTime ?? 60,
        enableDailyDigest: settings.reminderSettings.enableDailyDigest ?? true,
        dailyDigestTime: settings.reminderSettings.dailyDigestTime ?? "09:00",
        dailyDigestTimezone: settings.reminderSettings.dailyDigestTimezone ?? "UTC",
        quietHoursStart: settings.reminderSettings.quietHoursStart ?? null,
        quietHoursEnd: settings.reminderSettings.quietHoursEnd ?? null,
        enableCalendarSync: settings.reminderSettings.enableCalendarSync ?? false,
        calendarSyncType: settings.reminderSettings.calendarSyncType ?? "all",
      }
    })

    updates.reminderSettings = {
      enablePushReminders: reminderSettings.enablePushReminders,
      enableEmailReminders: reminderSettings.enableEmailReminders,
      defaultReminderTime: reminderSettings.defaultReminderTime,
      enableDailyDigest: reminderSettings.enableDailyDigest,
      dailyDigestTime: reminderSettings.dailyDigestTime,
      dailyDigestTimezone: reminderSettings.dailyDigestTimezone,
      quietHoursStart: reminderSettings.quietHoursStart,
      quietHoursEnd: reminderSettings.quietHoursEnd,
      enableCalendarSync: reminderSettings.enableCalendarSync,
      calendarSyncType: reminderSettings.calendarSyncType,
    }
  }

  return {
    success: true,
    settings: updates
  }
}
