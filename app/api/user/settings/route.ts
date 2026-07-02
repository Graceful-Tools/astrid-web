/**
 * User Settings API
 * GET: Fetch user settings
 * PATCH: Update user settings
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authConfig } from '@/lib/auth-config'
import { prisma } from '@/lib/prisma'
import { trackEventFromRequest, AnalyticsEventType } from '@/lib/analytics-events'
import { createLogger } from '@/lib/logger'

const log = createLogger('user.settings')


export async function GET() {
  try {
    const session = await getServerSession(authConfig)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        emailToTaskEnabled: true,
        defaultTaskDueOffset: true,
        defaultDueTime: true,
        smartTaskCreationEnabled: true,
        subtaskDisplay: true,
      }
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    return NextResponse.json(user)
  } catch (error) {
    log.error({ err: error }, 'Error fetching user settings:')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await getServerSession(authConfig)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const data = await request.json()

    // Validate allowed fields
    const allowedFields = ['emailToTaskEnabled', 'defaultTaskDueOffset', 'defaultDueTime', 'emailToTaskListId', 'smartTaskCreationEnabled', 'subtaskDisplay']
    const updateData: any = {}

    for (const field of allowedFields) {
      if (field in data) {
        updateData[field] = data[field]
      }
    }

    // Validate subtaskDisplay values
    if (updateData.subtaskDisplay && !['indented', 'under_parent'].includes(updateData.subtaskDisplay)) {
      return NextResponse.json({ error: 'Invalid subtaskDisplay value' }, { status: 400 })
    }

    // Validate defaultTaskDueOffset values
    if (updateData.defaultTaskDueOffset) {
      const validOffsets = ['none', '1_day', '3_days', '1_week']
      if (!validOffsets.includes(updateData.defaultTaskDueOffset)) {
        return NextResponse.json(
          { error: 'Invalid defaultTaskDueOffset value' },
          { status: 400 }
        )
      }
    }

    // Validate defaultDueTime format (HH:MM)
    if (updateData.defaultDueTime) {
      const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/
      if (!timeRegex.test(updateData.defaultDueTime)) {
        return NextResponse.json(
          { error: 'Invalid defaultDueTime format (must be HH:MM)' },
          { status: 400 }
        )
      }
    }

    // SECURITY: Validate user has access to emailToTaskListId before setting
    if (updateData.emailToTaskListId) {
      const list = await prisma.taskList.findFirst({
        where: {
          id: updateData.emailToTaskListId,
          OR: [
            { ownerId: session.user.id },
            { listMembers: { some: { userId: session.user.id } } }
          ]
        }
      })

      if (!list) {
        return NextResponse.json(
          { error: 'List not found or access denied' },
          { status: 403 }
        )
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id: session.user.id },
      data: updateData,
      select: {
        emailToTaskEnabled: true,
        defaultTaskDueOffset: true,
        defaultDueTime: true,
        smartTaskCreationEnabled: true,
        subtaskDisplay: true,
      }
    })

    // Track analytics
    trackEventFromRequest(request, session.user.id, AnalyticsEventType.SETTINGS_UPDATED, {
      settingsType: 'userPreferences'
    })

    return NextResponse.json(updatedUser)
  } catch (error) {
    log.error({ err: error }, 'Error updating user settings:')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
