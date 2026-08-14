/**
 * POST /api/v1/reminders/:id/snooze
 *
 * Snooze a single reminder by N minutes (1 minute to 1 week). The rule —
 * ownership, the 5-snooze cap, the reschedule — lives in
 * lib/reminder-snooze.ts and is shared with the legacy route. This handler owns
 * only OAuth scope auth and the `meta` envelope, which is what actually
 * differs between the two (and is pinned by tests/api/v1-contract.test.ts).
 * (Task e0613ae5.)
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { z } from 'zod'
import { createLogger } from '@/lib/logger'
import { snoozeReminder } from '@/lib/reminder-snooze'

const log = createLogger('v1.reminders.snooze')

type RouteContext = { params: Promise<{ id: string }> }

const SnoozeSchema = z.object({
  minutes: z.number().min(1).max(10080),
})

export const POST = withAuth<RouteContext>(
  { scopes: ['user:write'], tag: 'v1.reminders.snooze' },
  async (req, auth, { params }) => {
    try {
      const { id: reminderId } = await params
      const { minutes } = SnoozeSchema.parse(await req.json())

      const result = await snoozeReminder({
        reminderId,
        userId: auth.userId,
        minutes,
      })

      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status })
      }

      return NextResponse.json({
        success: true as const,
        scheduledFor: result.scheduledFor,
        snoozeCount: result.snoozeCount,
        meta: { apiVersion: 'v1' as const, authSource: auth.source },
      })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Invalid snooze duration', details: error.errors },
          { status: 400 }
        )
      }
      log.error({ err: error }, 'Error snoozing reminder')
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
