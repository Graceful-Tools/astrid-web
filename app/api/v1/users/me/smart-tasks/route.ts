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

const log = createLogger('v1.users.me.smart-tasks')

const SELECT = {
  emailToTaskEnabled: true,
  defaultTaskDueOffset: true,
  defaultDueTime: true,
  smartTaskCreationEnabled: true,
  subtaskDisplay: true,
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
