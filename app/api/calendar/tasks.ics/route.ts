import { capabilityGate } from '@/lib/brand/capabilities'
import { NextRequest, NextResponse } from 'next/server'
import { getUnifiedSession } from '@/lib/session-utils'
import { prisma } from '@/lib/prisma'
import { format } from 'date-fns'
import { createLogger } from '@/lib/logger'

const log = createLogger('calendar.tasks.ics')


// ICS (iCalendar) format helper functions
function formatDateForICS(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function escapeICSText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
}

function generateUID(taskId: string): string {
  return `task-${taskId}@astrid-tasks.com`
}

export async function GET(request: NextRequest) {
  const blocked = capabilityGate('calendarFeed')
  if (blocked) return blocked

  try {
    const session = await getUnifiedSession()
    
    if (!session?.user?.id) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    // Get user's calendar settings
    const reminderSettings = await prisma.reminderSettings.findUnique({
      where: { userId: session.user.id }
    })

    // If calendar sync is disabled, return empty calendar
    if (!reminderSettings?.enableCalendarSync || reminderSettings.calendarSyncType === 'none') {
      const emptyCalendar = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Astrid Tasks//Astrid Tasks//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'X-WR-CALNAME:Astrid Tasks',
        'X-WR-CALDESC:Tasks from Astrid Task Manager',
        'END:VCALENDAR'
      ].join('\r\n')

      return new NextResponse(emptyCalendar, {
        headers: {
          'Content-Type': 'text/calendar; charset=utf-8',
          'Content-Disposition': 'attachment; filename="astrid-tasks.ics"'
        }
      })
    }

    // Build query based on sync type
    let whereClause: any = {
      OR: [
        { assigneeId: session.user.id },
        { creatorId: session.user.id }
      ],
      completed: false
    }

    // Filter based on calendar sync type
    if (reminderSettings.calendarSyncType === 'with_due_times') {
      whereClause.OR = [
        { ...whereClause.OR[0], NOT: { dueDateTime: null } },
        { ...whereClause.OR[0], NOT: { when: null } },
        { ...whereClause.OR[1], NOT: { dueDateTime: null } },
        { ...whereClause.OR[1], NOT: { when: null } }
      ]
    }

    // Get tasks
    const tasks = await prisma.task.findMany({
      where: whereClause,
      include: {
        lists: {
          select: { name: true }
        },
        assignee: {
          select: { name: true, email: true }
        },
        creator: {
          select: { name: true, email: true }
        }
      },
      orderBy: [
        { dueDateTime: 'asc' },
        { createdAt: 'asc' }
      ]
    })

    // Generate ICS content
    const events = tasks.map(task => {
      // Determine event date and time
      let startDate: Date
      let isAllDay = false

      if (task.dueDateTime) {
        startDate = new Date(task.dueDateTime)
        // Check isAllDay flag if available, otherwise check time component
        isAllDay = task.isAllDay ?? (startDate.getHours() === 0 && startDate.getMinutes() === 0)
      } else {
        // For tasks without dates, use created date as all-day event
        startDate = new Date(task.createdAt)
        isAllDay = true
      }

      // Create end date (same as start for all-day, +1 hour for timed events)
      const endDate = new Date(startDate)
      if (!isAllDay) {
        endDate.setHours(endDate.getHours() + 1)
      }

      // Build description
      let description = escapeICSText(task.description || '')
      if (task.lists.length > 0) {
        const listNames = task.lists.map(l => l.name).join(', ')
        description += `\\n\\nLists: ${escapeICSText(listNames)}`
      }
      if (task.assignee && task.assignee.name) {
        description += `\\n\\nAssigned to: ${escapeICSText(task.assignee.name)}`
      }

      // Priority mapping (0=none, 1=low, 2=medium, 3=high)
      const priorityMap = { 0: 0, 1: 9, 2: 5, 3: 1 }
      const priority = priorityMap[task.priority as keyof typeof priorityMap] || 0

      // Build status
      const status = task.completed ? 'COMPLETED' : 'NEEDS-ACTION'

      const event = [
        'BEGIN:VEVENT',
        `UID:${generateUID(task.id)}`,
        `DTSTART${isAllDay ? ';VALUE=DATE' : ''}:${formatDateForICS(startDate)}`,
        `DTEND${isAllDay ? ';VALUE=DATE' : ''}:${formatDateForICS(endDate)}`,
        `DTSTAMP:${formatDateForICS(new Date())}`,
        `CREATED:${formatDateForICS(new Date(task.createdAt))}`,
        `LAST-MODIFIED:${formatDateForICS(new Date(task.updatedAt))}`,
        `SUMMARY:${escapeICSText(task.title)}`,
        description ? `DESCRIPTION:${description}` : '',
        `STATUS:${status}`,
        `PRIORITY:${priority}`,
        'CATEGORIES:Astrid Tasks',
        task.assignee?.email ? `ATTENDEE:mailto:${task.assignee.email}` : '',
        'END:VEVENT'
      ].filter(line => line !== '').join('\r\n')

      return event
    })

    // Build complete ICS file
    const calendar = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Astrid Tasks//Astrid Tasks//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:Astrid Tasks',
      'X-WR-CALDESC:Tasks from Astrid Task Manager',
      'X-WR-TIMEZONE:UTC',
      'X-PUBLISHED-TTL:PT1H', // Refresh every hour
      ...events,
      'END:VCALENDAR'
    ].join('\r\n')

    return new NextResponse(calendar, {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'attachment; filename="astrid-tasks.ics"',
        'Cache-Control': 'public, max-age=300', // Cache for 5 minutes
        'X-Calendar-Type': reminderSettings.calendarSyncType
      }
    })

  } catch (error) {
    log.error({ err: error }, 'Error generating calendar:')
    return new NextResponse('Internal Server Error', { status: 500 })
  }
}