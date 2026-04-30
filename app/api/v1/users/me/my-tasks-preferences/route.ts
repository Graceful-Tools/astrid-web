/**
 * GET/PATCH /api/v1/users/me/my-tasks-preferences
 *
 * The "My Tasks" filter/sort preferences. Sync state lives in user.
 * myTasksPreferences as a JSON-stringified blob; we parse on read,
 * stringify on write. Mirrors GET/PATCH /api/user/my-tasks-preferences.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.users.me.my-tasks-preferences')

export interface MyTasksPreferences {
  filterPriority?: number[]
  filterAssignee?: string[]
  filterDueDate?: string
  filterCompletion?: string
  sortBy?: string
  manualSortOrder?: string[]
}

const DEFAULTS: MyTasksPreferences = {
  filterPriority: [],
  filterAssignee: [],
  filterDueDate: 'all',
  filterCompletion: 'default',
  sortBy: 'priority',
  manualSortOrder: [],
}

export const GET = withAuth(
  { scopes: ['user:read'], tag: 'v1.users.me.my-tasks-preferences' },
  async (_req, auth) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: auth.userId },
        select: { myTasksPreferences: true },
      })
      if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

      const preferences: MyTasksPreferences = user.myTasksPreferences
        ? JSON.parse(user.myTasksPreferences)
        : DEFAULTS
      return NextResponse.json({
        ...preferences,
        meta: { apiVersion: 'v1' as const, authSource: auth.source },
      })
    } catch (error) {
      log.error({ err: error }, 'Error fetching my-tasks preferences')
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)

const VALID_DUE_DATE = ['all', 'overdue', 'today', 'tomorrow', 'this_week', 'this_month', 'no_date']
const VALID_COMPLETION = ['default', 'all', 'completed', 'incomplete']
const VALID_SORT = ['auto', 'priority', 'when', 'assignee', 'completed', 'incomplete', 'manual']

export const PATCH = withAuth(
  { scopes: ['user:write'], tag: 'v1.users.me.my-tasks-preferences' },
  async (req, auth) => {
    try {
      const data: MyTasksPreferences = await req.json()

      if (data.filterPriority && !Array.isArray(data.filterPriority)) {
        return NextResponse.json({ error: 'filterPriority must be an array' }, { status: 400 })
      }
      if (data.filterAssignee && !Array.isArray(data.filterAssignee)) {
        return NextResponse.json({ error: 'filterAssignee must be an array' }, { status: 400 })
      }
      if (data.filterDueDate && !VALID_DUE_DATE.includes(data.filterDueDate)) {
        return NextResponse.json({ error: 'Invalid filterDueDate value' }, { status: 400 })
      }
      if (data.filterCompletion && !VALID_COMPLETION.includes(data.filterCompletion)) {
        return NextResponse.json({ error: 'Invalid filterCompletion value' }, { status: 400 })
      }
      if (data.sortBy && !VALID_SORT.includes(data.sortBy)) {
        return NextResponse.json({ error: 'Invalid sortBy value' }, { status: 400 })
      }

      const current = await prisma.user.findUnique({
        where: { id: auth.userId },
        select: { myTasksPreferences: true },
      })
      const currentPrefs: MyTasksPreferences = current?.myTasksPreferences
        ? JSON.parse(current.myTasksPreferences)
        : {}
      const updated: MyTasksPreferences = { ...currentPrefs, ...data }

      const result = await prisma.user.update({
        where: { id: auth.userId },
        data: { myTasksPreferences: JSON.stringify(updated) },
        select: { myTasksPreferences: true },
      })

      try {
        const { broadcastToUsers } = await import('@/lib/sse-utils')
        broadcastToUsers([auth.userId], {
          type: 'my_tasks_preferences_updated',
          timestamp: new Date().toISOString(),
          data: updated,
        })
      } catch (sseError) {
        log.error({ err: sseError }, 'Failed to send SSE notification')
      }

      const parsed = result.myTasksPreferences ? JSON.parse(result.myTasksPreferences) : updated
      return NextResponse.json({
        ...parsed,
        meta: { apiVersion: 'v1' as const, authSource: auth.source },
      })
    } catch (error) {
      log.error({ err: error }, 'Error updating my-tasks preferences')
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
