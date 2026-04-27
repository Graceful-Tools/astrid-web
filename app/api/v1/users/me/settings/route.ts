/**
 * User Settings API v1
 *
 * GET /api/v1/users/me/settings - Get current user's settings
 * PUT /api/v1/users/me/settings - Update current user's settings
 */

import { NextResponse } from 'next/server'
import { getDeprecationWarning } from '@/lib/api-auth-middleware'
import { prisma } from '@/lib/prisma'
import { trackEventFromRequest, AnalyticsEventType } from '@/lib/analytics-events'
import { withAuth } from '@/lib/api-auth-wrapper'

const DEFAULT_REMINDER_SETTINGS = {
  enablePushReminders: false,
  enableEmailReminders: true,
  defaultReminderTime: 15,
  enableDailyDigest: false,
  dailyDigestTime: '09:00',
  dailyDigestTimezone: 'America/Los_Angeles',
  quietHoursStart: null,
  quietHoursEnd: null,
}

const reminderSettingsSelect = {
  enablePushReminders: true,
  enableEmailReminders: true,
  defaultReminderTime: true,
  enableDailyDigest: true,
  dailyDigestTime: true,
  dailyDigestTimezone: true,
  quietHoursStart: true,
  quietHoursEnd: true,
} as const

function buildSettingsResponse(
  reminderSettings: Record<string, unknown> | null | undefined,
  authSource: string
) {
  const s = reminderSettings ?? DEFAULT_REMINDER_SETTINGS
  return {
    settings: {
      reminderSettings: {
        enablePushReminders: s.enablePushReminders ?? false,
        enableEmailReminders: s.enableEmailReminders ?? true,
        defaultReminderTime: s.defaultReminderTime ?? 15,
        enableDailyDigest: s.enableDailyDigest ?? false,
        dailyDigestTime: s.dailyDigestTime ?? '09:00',
        dailyDigestTimezone: s.dailyDigestTimezone ?? 'America/Los_Angeles',
        quietHoursStart: s.quietHoursStart ?? null,
        quietHoursEnd: s.quietHoursEnd ?? null,
      },
    },
    meta: {
      apiVersion: 'v1',
      authSource,
    },
  }
}

/**
 * GET /api/v1/users/me/settings
 * Get current user's settings
 */
export const GET = withAuth(
  { scopes: ['user:read'], tag: 'v1.users.me.settings' },
  async (_req, auth) => {
    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: {
        id: true,
        email: true,
        name: true,
        reminderSettings: { select: reminderSettingsSelect },
      },
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) headers['X-Deprecation-Warning'] = deprecationWarning

    return NextResponse.json(
      buildSettingsResponse(user.reminderSettings, auth.source),
      { headers }
    )
  }
)

/**
 * PUT /api/v1/users/me/settings
 * Update current user's settings
 */
export const PUT = withAuth(
  { scopes: ['user:write'], tag: 'v1.users.me.settings' },
  async (req, auth) => {
    const body = await req.json()

    // Validate and prepare update data
    const updateData: any = {}

    if (body.reminderSettings) {
      const { reminderSettings } = body

      if (typeof reminderSettings.enablePushReminders === 'boolean') {
        updateData.enablePushReminders = reminderSettings.enablePushReminders
      }
      if (typeof reminderSettings.enableEmailReminders === 'boolean') {
        updateData.enableEmailReminders = reminderSettings.enableEmailReminders
      }
      if (typeof reminderSettings.defaultReminderTime === 'number') {
        updateData.defaultReminderTime = reminderSettings.defaultReminderTime
      }
      if (typeof reminderSettings.enableDailyDigest === 'boolean') {
        updateData.enableDailyDigest = reminderSettings.enableDailyDigest
      }
      if (typeof reminderSettings.dailyDigestTime === 'string') {
        updateData.dailyDigestTime = reminderSettings.dailyDigestTime
      }
      if (typeof reminderSettings.dailyDigestTimezone === 'string') {
        updateData.dailyDigestTimezone = reminderSettings.dailyDigestTimezone
      }
      if (reminderSettings.quietHoursStart !== undefined) {
        updateData.quietHoursStart = reminderSettings.quietHoursStart
      }
      if (reminderSettings.quietHoursEnd !== undefined) {
        updateData.quietHoursEnd = reminderSettings.quietHoursEnd
      }
    }

    // Upsert reminder settings
    await prisma.reminderSettings.upsert({
      where: { userId: auth.userId },
      create: { userId: auth.userId, ...updateData },
      update: updateData,
    })

    trackEventFromRequest(req, auth.userId, AnalyticsEventType.SETTINGS_UPDATED, {
      settingsType: 'reminderSettings',
    })

    // Fetch updated user
    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: {
        id: true,
        email: true,
        name: true,
        reminderSettings: { select: reminderSettingsSelect },
      },
    })

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) headers['X-Deprecation-Warning'] = deprecationWarning

    return NextResponse.json(
      buildSettingsResponse(user?.reminderSettings, auth.source),
      { headers }
    )
  }
)
