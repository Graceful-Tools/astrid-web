/**
 * POST /api/v1/reminders/:id/dismiss
 *
 * Dismiss a single reminder. With `{ dismissAll: true }` in the body,
 * dismisses all pending reminders for the same task and marks the task
 * `reminderSent: true`.
 *
 * The rule lives in lib/reminder-dismiss.ts and is shared with the legacy
 * route; this handler owns only OAuth scope auth and the `meta` envelope,
 * which is what actually differs between the two. (Task e0613ae5.)
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { z } from 'zod'
import { createLogger } from '@/lib/logger'
import { dismissReminder } from '@/lib/reminder-dismiss'

const log = createLogger('v1.reminders.dismiss')

type RouteContext = { params: Promise<{ id: string }> }

const DismissSchema = z.object({
  dismissAll: z.boolean().optional().default(false),
})

export const POST = withAuth<RouteContext>(
  { scopes: ['user:write'], tag: 'v1.reminders.dismiss' },
  async (req, auth, { params }) => {
    try {
      const { id: reminderId } = await params

      const body = await req.text()
      const { dismissAll } = body ? DismissSchema.parse(JSON.parse(body)) : { dismissAll: false }

      const result = await dismissReminder({
        reminderId,
        userId: auth.userId,
        dismissAll,
      })

      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status })
      }

      return NextResponse.json({
        success: true as const,
        dismissedCount: result.dismissedCount,
        meta: { apiVersion: 'v1' as const, authSource: auth.source },
      })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Invalid request data', details: error.errors },
          { status: 400 }
        )
      }
      log.error({ err: error }, 'Error dismissing reminder')
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
