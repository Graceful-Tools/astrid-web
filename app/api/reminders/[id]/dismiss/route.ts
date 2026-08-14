/**
 * POST /api/reminders/:id/dismiss (legacy)
 *
 * The dismiss rule lives in lib/reminder-dismiss.ts and is shared with the v1
 * route. This handler owns only what is genuinely legacy: session auth, and a
 * response with no `meta` envelope. (Task e0613ae5.)
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUnifiedSession } from '@/lib/session-utils'
import { z } from 'zod'
import type { RouteContextParams } from '@/types/next'
import { createLogger } from '@/lib/logger'
import { dismissReminder } from '@/lib/reminder-dismiss'

const log = createLogger('reminders.[id].dismiss')

const DismissSchema = z.object({
  dismissAll: z.boolean().optional().default(false),
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

    const body = await request.text()
    const { dismissAll } = body ? DismissSchema.parse(JSON.parse(body)) : { dismissAll: false }

    const { id: reminderId } = await context.params

    const result = await dismissReminder({
      reminderId,
      userId: session.user.id,
      dismissAll,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({
      success: true,
      dismissedCount: result.dismissedCount,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    log.error({ err: error }, 'Error dismissing reminder:')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
