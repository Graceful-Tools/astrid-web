/**
 * User Settings API v1
 *
 * GET /api/v1/users/me/settings - Get current user's settings
 * PUT /api/v1/users/me/settings - Update current user's settings
 *
 * `locale` (top level, beside `reminderSettings`) is the language the user reads,
 * for push notifications and reminder/digest emails (AWTD-1592). A client sends
 * a BCP 47 tag as its platform spells it (`de-DE`, `zh-Hant`); it is stored as
 * one of the app's twelve locales, a tag that is none of them is a 400, and
 * `null` forgets it. GET answers `settings.locale`, null when unknown.
 */

import { NextResponse } from 'next/server'
import { getDeprecationWarning } from '@/lib/api-auth-middleware'
import { prisma } from '@/lib/prisma'
import { trackEventFromRequest, AnalyticsEventType } from '@/lib/analytics-events'
import { withAuth } from '@/lib/api-auth-wrapper'
import { digestScheduleReset } from '@/lib/digest-schedule'
import { normalizeLocale } from '@/lib/i18n/user-locale'

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
  authSource: string,
  locale: string | null | undefined
) {
  const s = reminderSettings ?? DEFAULT_REMINDER_SETTINGS
  return {
    settings: {
      locale: locale ?? null,
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
        locale: true,
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
      buildSettingsResponse(user.reminderSettings, auth.source, user.locale),
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

    // Validated before anything is written, so a bad tag changes nothing.
    let locale: string | null | undefined
    if (body.locale === null) {
      locale = null
    } else if (body.locale !== undefined) {
      locale = normalizeLocale(body.locale)
      if (!locale) {
        return NextResponse.json(
          { error: 'Unsupported locale: send a BCP 47 tag for one of the supported languages, or null' },
          { status: 400 }
        )
      }
    }

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
      // A digest time / zone / switch change reschedules the digests (AWTD-1454).
      update: { ...updateData, ...digestScheduleReset(updateData) },
    })

    if (locale !== undefined) {
      await prisma.user.update({ where: { id: auth.userId }, data: { locale } })
    }

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
        locale: true,
        reminderSettings: { select: reminderSettingsSelect },
      },
    })

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) headers['X-Deprecation-Warning'] = deprecationWarning

    return NextResponse.json(
      buildSettingsResponse(user?.reminderSettings, auth.source, user?.locale),
      { headers }
    )
  }
)
