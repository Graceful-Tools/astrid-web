/**
 * My Tasks Preferences API
 * GET: Fetch user's My Tasks filter preferences
 * PATCH: Update user's My Tasks filter preferences
 * Syncs preferences across devices (web + iOS)
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authConfig } from '@/lib/auth-config'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'

const log = createLogger('user.my-tasks-preferences')


export interface MyTasksPreferences {
  filterPriority?: number[]
  filterAssignee?: string[]
  filterDueDate?: string
  filterCompletion?: string
  sortBy?: string
  manualSortOrder?: string[]
}

export async function GET(request: NextRequest) {
  try {
    let session = await getServerSession(authConfig)

    // Fallback to database session for mobile apps
    if (!session?.user) {
      const cookieHeader = request.headers.get('cookie')
      const sessionTokenMatch = cookieHeader?.match(/next-auth\.session-token=([^;]+)/)

      if (sessionTokenMatch) {
        const sessionToken = sessionTokenMatch[1]
        const dbSession = await prisma.session.findUnique({
          where: { sessionToken },
          include: { user: true }
        })

        if (dbSession && dbSession.expires > new Date()) {
          session = {
            user: {
              id: dbSession.user.id,
              email: dbSession.user.email,
              name: dbSession.user.name,
              image: dbSession.user.image,
            },
            expires: dbSession.expires.toISOString()
          }
        }
      }
    }

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        myTasksPreferences: true,
      }
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Parse JSON preferences or return defaults
    // Note: empty filterPriority means "show all" (no filter), NOT [0,1,2,3]
    const preferences: MyTasksPreferences = user.myTasksPreferences
      ? JSON.parse(user.myTasksPreferences)
      : {
          filterPriority: [],  // Empty = no filter (show all priorities)
          filterAssignee: [],
          filterDueDate: 'all',
          filterCompletion: 'default',
          sortBy: 'priority',
          manualSortOrder: [],
        }

    return NextResponse.json(preferences)
  } catch (error) {
    log.error({ err: error }, 'Error fetching My Tasks preferences:')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    let session = await getServerSession(authConfig)

    // Fallback to database session for mobile apps
    if (!session?.user) {
      const cookieHeader = request.headers.get('cookie')
      const sessionTokenMatch = cookieHeader?.match(/next-auth\.session-token=([^;]+)/)

      if (sessionTokenMatch) {
        const sessionToken = sessionTokenMatch[1]
        const dbSession = await prisma.session.findUnique({
          where: { sessionToken },
          include: { user: true }
        })

        if (dbSession && dbSession.expires > new Date()) {
          session = {
            user: {
              id: dbSession.user.id,
              email: dbSession.user.email,
              name: dbSession.user.name,
              image: dbSession.user.image,
            },
            expires: dbSession.expires.toISOString()
          }
        }
      }
    }

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const data: MyTasksPreferences = await request.json()

    // Validate filter values
    if (data.filterPriority && !Array.isArray(data.filterPriority)) {
      return NextResponse.json(
        { error: 'filterPriority must be an array' },
        { status: 400 }
      )
    }

    if (data.filterAssignee && !Array.isArray(data.filterAssignee)) {
      return NextResponse.json(
        { error: 'filterAssignee must be an array' },
        { status: 400 }
      )
    }

    const validDueDates = ['all', 'overdue', 'today', 'tomorrow', 'this_week', 'this_month', 'no_date']
    if (data.filterDueDate && !validDueDates.includes(data.filterDueDate)) {
      return NextResponse.json(
        { error: 'Invalid filterDueDate value' },
        { status: 400 }
      )
    }

    const validCompletions = ['default', 'all', 'completed', 'incomplete']
    if (data.filterCompletion && !validCompletions.includes(data.filterCompletion)) {
      return NextResponse.json(
        { error: 'Invalid filterCompletion value' },
        { status: 400 }
      )
    }

    const validSortOptions = ['auto', 'priority', 'when', 'assignee', 'completed', 'incomplete', 'manual']
    if (data.sortBy && !validSortOptions.includes(data.sortBy)) {
      return NextResponse.json(
        { error: 'Invalid sortBy value' },
        { status: 400 }
      )
    }

    // Get current preferences and merge with new data
    const currentUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { myTasksPreferences: true }
    })

    const currentPrefs: MyTasksPreferences = currentUser?.myTasksPreferences
      ? JSON.parse(currentUser.myTasksPreferences)
      : {}

    const updatedPreferences: MyTasksPreferences = {
      ...currentPrefs,
      ...data,
    }

    // Update user preferences
    const updatedUser = await prisma.user.update({
      where: { id: session.user.id },
      data: {
        myTasksPreferences: JSON.stringify(updatedPreferences),
      },
      select: {
        myTasksPreferences: true,
      }
    })

    // Broadcast SSE event to user's other sessions/devices
    try {
      const { broadcastToUsers } = await import('@/lib/sse-utils')
      broadcastToUsers([session.user.id], {
        type: 'my_tasks_preferences_updated',
        timestamp: new Date().toISOString(),
        data: updatedPreferences,
      })
    } catch (sseError) {
      log.error({ err: sseError }, '[MyTasksPrefs] Failed to send SSE notification:')
    }

    const parsedPreferences = updatedUser.myTasksPreferences
      ? JSON.parse(updatedUser.myTasksPreferences)
      : updatedPreferences

    return NextResponse.json(parsedPreferences)
  } catch (error) {
    log.error({ err: error }, 'Error updating My Tasks preferences:')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
