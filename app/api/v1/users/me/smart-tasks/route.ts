/**
 * GET/PATCH /api/v1/users/me/smart-tasks
 *
 * Smart-task creation defaults: emailToTaskEnabled, defaultTaskDueOffset,
 * defaultDueTime, smartTaskCreationEnabled, emailToTaskListId.
 * Mirrors GET/PATCH /api/v1/users/me/smart-tasks.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { isTaskDisplayMode } from '@/lib/task-display-mode'

const log = createLogger('v1.users.me.smart-tasks')

const SELECT = {
  emailToTaskEnabled: true,
  defaultTaskDueOffset: true,
  defaultDueTime: true,
  smartTaskCreationEnabled: true,
  subtaskDisplay: true,
  taskDisplayMode: true,
} as const

export const GET = withAuth(
  { scopes: ['user:read'], tag: 'v1.users.me.smart-tasks' },
  async (_req, auth) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: auth.userId },
        select: SELECT,
      })
      if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })
      return NextResponse.json({
        ...user,
        meta: { apiVersion: 'v1' as const, authSource: auth.source },
      })
    } catch (error) {
      log.error({ err: error }, 'Error fetching smart-task settings')
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)

const ALLOWED = [
  'emailToTaskEnabled',
  'defaultTaskDueOffset',
  'defaultDueTime',
  'emailToTaskListId',
  'smartTaskCreationEnabled',
  'subtaskDisplay',
  'taskDisplayMode',
] as const
const VALID_OFFSETS = ['none', '1_day', '3_days', '1_week']
/** The two layouts the task list can actually render. */
const VALID_SUBTASK_DISPLAY = ['indented', 'under_parent']
const TIME_RE = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/

export const PATCH = withAuth(
  { scopes: ['user:write'], tag: 'v1.users.me.smart-tasks' },
  async (req, auth) => {
    try {
      const data = await req.json()
      const updateData: Record<string, unknown> = {}
      for (const field of ALLOWED) {
        if (field in data) updateData[field] = data[field]
      }

      // Rejected rather than coerced: a client that sends a mode this build
      // does not know should learn it, instead of having the toggle silently
      // do nothing. Validated through the shared helper so this surface and
      // the legacy one cannot drift on what is allowed (task ffa5bbb5).
      if (
        'taskDisplayMode' in updateData &&
        !isTaskDisplayMode(updateData.taskDisplayMode)
      ) {
        return NextResponse.json(
          { error: 'Invalid taskDisplayMode value' },
          { status: 400 }
        )
      }
      if (
        updateData.subtaskDisplay &&
        !VALID_SUBTASK_DISPLAY.includes(updateData.subtaskDisplay as string)
      ) {
        return NextResponse.json(
          { error: 'Invalid subtaskDisplay value' },
          { status: 400 }
        )
      }
      if (
        updateData.defaultTaskDueOffset &&
        !VALID_OFFSETS.includes(updateData.defaultTaskDueOffset as string)
      ) {
        return NextResponse.json(
          { error: 'Invalid defaultTaskDueOffset value' },
          { status: 400 }
        )
      }
      if (
        updateData.defaultDueTime &&
        !TIME_RE.test(updateData.defaultDueTime as string)
      ) {
        return NextResponse.json(
          { error: 'Invalid defaultDueTime format (must be HH:MM)' },
          { status: 400 }
        )
      }

      if (updateData.emailToTaskListId) {
        const list = await prisma.taskList.findFirst({
          where: {
            id: updateData.emailToTaskListId as string,
            OR: [
              { ownerId: auth.userId },
              { listMembers: { some: { userId: auth.userId } } },
            ],
          },
        })
        if (!list) {
          return NextResponse.json(
            { error: 'List not found or access denied' },
            { status: 403 }
          )
        }
      }

      const updated = await prisma.user.update({
        where: { id: auth.userId },
        data: updateData,
        select: SELECT,
      })

      // Tell this user's other devices (task 9523d634).
      //
      // hooks/useUserSettings.ts has subscribed to `user_settings_updated`
      // since it was written, and NOTHING emitted it — the "synced across
      // devices" claim in its header was false and the sync was a no-op. Jon's
      // decision (a) was to keep settings online-only and make the parts that
      // pretend to work actually work, so the event is emitted rather than the
      // subscription deleted. Same shape as the my-tasks-preferences route,
      // which has always emitted its own event correctly.
      //
      // THIS USER ONLY: these are personal preferences, and the array is how
      // they would leak to every account.
      //
      // The write has already committed, so a broadcast failure is logged and
      // swallowed — it must never turn a saved setting into an error.
      try {
        const { broadcastToUsers } = await import('@/lib/sse-utils')
        broadcastToUsers([auth.userId], {
          type: 'user_settings_updated',
          timestamp: new Date().toISOString(),
          data: updated,
        })
      } catch (sseError) {
        log.error({ err: sseError }, 'Failed to send user_settings_updated SSE')
      }

      return NextResponse.json({
        ...updated,
        meta: { apiVersion: 'v1' as const, authSource: auth.source },
      })
    } catch (error) {
      log.error({ err: error }, 'Error updating smart-task settings')
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
