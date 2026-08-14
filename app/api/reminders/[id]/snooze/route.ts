/**
 * POST /api/reminders/:id/snooze (legacy)
 *
 * The snooze rule lives in lib/reminder-snooze.ts and is shared with the v1
 * route. This handler owns only what is genuinely legacy: session auth, and a
 * response with no `meta` envelope (pinned by tests/api/legacy-contract.test.ts).
 * (Task e0613ae5.)
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUnifiedSession } from '@/lib/session-utils'
import { z } from 'zod'
import type { RouteContextParams } from '@/types/next'
import { createLogger } from '@/lib/logger'
import { snoozeReminder } from '@/lib/reminder-snooze'

const log = createLogger('reminders.[id].snooze')

const SnoozeSchema = z.object({
  minutes: z.number().min(1).max(10080), // 1 minute to 1 week
})

export async function POST(
  request: NextRequest,
  context: RouteContextParams<{ id: string }>
) {
  try {
    const session = await getUnifiedSession()

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { minutes } = SnoozeSchema.parse(await request.json())
    const { id: reminderId } = await context.params

    const result = await snoozeReminder({
      reminderId,
      userId: session.user.id,
      minutes,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({
      success: true,
      scheduledFor: result.scheduledFor,
      snoozeCount: result.snoozeCount,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid snooze duration', details: error.errors },
        { status: 400 }
      )
    }

    log.error({ err: error }, 'Error snoozing reminder:')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
