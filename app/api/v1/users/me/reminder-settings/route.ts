/**
 * GET/PUT /api/v1/users/me/reminder-settings
 *
 * Reminder, digest, quiet-hours and calendar-sync preferences. Mirrors
 * GET/PUT /api/user/reminder-settings (task 641a7615, decision 3A) — same
 * fields and the same validation bounds, plus a v1 `meta` envelope, and it
 * accepts an OAuth token as well as a session cookie.
 *
 * The GET seeds defaults when the user has none. That is a read that writes,
 * which is surprising enough to state: clients depend on always getting a
 * complete settings object rather than null on first load, so the row is
 * created rather than the shape being made optional everywhere downstream.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.users.me.reminder-settings')

const HHMM = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/

/** Bounds mirror the legacy route exactly — 10080 minutes is 7 days. */
const ReminderSettingsSchema = z.object({
  enablePushReminders: z.boolean().optional(),
  enableEmailReminders: z.boolean().optional(),
  defaultReminderTime: z.number().min(0).max(10080).optional(),
  enableDailyDigest: z.boolean().optional(),
  dailyDigestTime: z.string().regex(HHMM).optional(),
  dailyDigestTimezone: z.string().optional(),
  quietHoursStart: z.string().regex(HHMM).nullable().optional(),
  quietHoursEnd: z.string().regex(HHMM).nullable().optional(),
  enableCalendarSync: z.boolean().optional(),
  calendarSyncType: z.enum(['all', 'with_due_times', 'none']).optional(),
})

const DEFAULTS = {
  enablePushReminders: true,
  enableEmailReminders: true,
  defaultReminderTime: 60,
  enableDailyDigest: true,
  dailyDigestTime: '09:00',
  dailyDigestTimezone: 'UTC',
  enableCalendarSync: false,
  calendarSyncType: 'all',
} as const

export const GET = withAuth(
  { scopes: ['user:read'], tag: 'v1.users.me.reminder-settings' },
  async (_req, auth) => {
    try {
      let settings = await prisma.reminderSettings.findUnique({
        where: { userId: auth.userId },
      })

      if (!settings) {
        settings = await prisma.reminderSettings.create({
          data: { userId: auth.userId, ...DEFAULTS },
        })
      }

      return NextResponse.json({
        ...settings,
        meta: { apiVersion: 'v1' as const, authSource: auth.source },
      })
    } catch (error) {
      log.error({ err: error }, 'Error fetching reminder settings')
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)

export const PUT = withAuth(
  { scopes: ['user:write'], tag: 'v1.users.me.reminder-settings' },
  async (req, auth) => {
    try {
      const body = await req.json().catch(() => ({}))
      const data = ReminderSettingsSchema.parse(body)

      const settings = await prisma.reminderSettings.upsert({
        where: { userId: auth.userId },
        update: { ...data, updatedAt: new Date() },
        create: { userId: auth.userId, ...data },
      })

      return NextResponse.json({
        ...settings,
        meta: { apiVersion: 'v1' as const, authSource: auth.source },
      })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Invalid request data', details: error.errors },
          { status: 400 }
        )
      }
      log.error({ err: error }, 'Error updating reminder settings')
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
