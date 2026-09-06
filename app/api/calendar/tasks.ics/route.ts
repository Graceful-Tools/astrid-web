import { BRAND } from '@/lib/brand/config'
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

/**
 * This feed is authenticated and per-user, and its URL carries no user
 * identity. `public` would authorise any shared cache keyed on that URL — a
 * CDN, a corporate proxy, an ISP cache — to store one person's tasks and serve
 * them to the next person who asks. Both exits must say the same thing, or the
 * empty-calendar response gets cached and served to a user whose sync is on
 * (task f9ba26b3).
 */
const PRIVATE_FEED_CACHE_CONTROL = 'private, no-store'

/** Only tasks in this window are published; an account's whole history is not a calendar. */
const CALENDAR_WINDOW_DAYS_PAST = 30
const CALENDAR_WINDOW_DAYS_FUTURE = 365
const MAX_CALENDAR_EVENTS = 1000

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
        `PRODID:-//${BRAND.appName} Tasks//${BRAND.appName} Tasks//EN`,
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        `X-WR-CALNAME:${BRAND.appName} Tasks`,
        `X-WR-CALDESC:Tasks from ${BRAND.appName} Task Manager`,
        'END:VCALENDAR'
      ].join('\r\n')

      return new NextResponse(emptyCalendar, {
        headers: {
          'Content-Type': 'text/calendar; charset=utf-8',
          'Content-Disposition': 'attachment; filename="astrid-tasks.ics"',
          'Cache-Control': PRIVATE_FEED_CACHE_CONTROL
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
    // Bounded in both time and count. This used to be every task the user could
    // see, ever, with no take — the response grew without limit and the query
    // scanned the account's whole history on a route a calendar client polls.
    const windowStart = new Date()
    windowStart.setUTCDate(windowStart.getUTCDate() - CALENDAR_WINDOW_DAYS_PAST)
    const windowEnd = new Date()
    windowEnd.setUTCDate(windowEnd.getUTCDate() + CALENDAR_WINDOW_DAYS_FUTURE)

    // The ownership OR moves under AND so the window cannot be swallowed by it:
    // `{ OR: ownership, OR: window }` is one key, and the second would win.
    const { OR: ownership, ...otherFilters } = whereClause

    const tasks = await prisma.task.findMany({
      where: {
        ...otherFilters,
        AND: [
          { OR: ownership },
          {
            OR: [
              { dueDateTime: { gte: windowStart, lte: windowEnd } },
              { when: { gte: windowStart, lte: windowEnd } },
              // Undated tasks have no place on the timeline to fall outside it.
              { dueDateTime: null, when: null },
            ],
          },
        ],
      },
      take: MAX_CALENDAR_EVENTS,
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
        `CATEGORIES:${BRAND.appName} Tasks`,
        task.assignee?.email ? `ATTENDEE:mailto:${task.assignee.email}` : '',
        'END:VEVENT'
      ].filter(line => line !== '').join('\r\n')

      return event
    })

    // Build complete ICS file
    const calendar = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      `PRODID:-//${BRAND.appName} Tasks//${BRAND.appName} Tasks//EN`,
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      `X-WR-CALNAME:${BRAND.appName} Tasks`,
      `X-WR-CALDESC:Tasks from ${BRAND.appName} Task Manager`,
      'X-WR-TIMEZONE:UTC',
      'X-PUBLISHED-TTL:PT1H', // Refresh every hour
      ...events,
      'END:VCALENDAR'
    ].join('\r\n')

    return new NextResponse(calendar, {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'attachment; filename="astrid-tasks.ics"',
        'Cache-Control': PRIVATE_FEED_CACHE_CONTROL,
        'X-Calendar-Type': reminderSettings.calendarSyncType
      }
    })

  } catch (error) {
    log.error({ err: error }, 'Error generating calendar:')
    return new NextResponse('Internal Server Error', { status: 500 })
  }
}