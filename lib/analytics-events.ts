import { BRAND } from '@/lib/brand/config'
import { NextRequest } from 'next/server'
import { prisma } from './prisma'
import { Prisma } from '@prisma/client'
import { createLogger } from '@/lib/logger'

const log = createLogger('analytics-events')


// Event types
export const AnalyticsEventType = {
  TASK_CREATED: 'task_created',
  TASK_EDITED: 'task_edited',
  TASK_COMPLETED: 'task_completed',
  TASK_DELETED: 'task_deleted',
  COMMENT_ADDED: 'comment_added',
  COMMENT_DELETED: 'comment_deleted',
  LIST_ADDED: 'list_added',
  LIST_EDITED: 'list_edited',
  LIST_DELETED: 'list_deleted',
  SETTINGS_UPDATED: 'settings_updated',
} as const

export type AnalyticsEventTypeValue =
  (typeof AnalyticsEventType)[keyof typeof AnalyticsEventType]

// Platform types
export const AnalyticsPlatform = {
  WEB_DESKTOP: 'web-desktop',
  WEB_IPHONE: 'web-iPhone',
  WEB_ANDROID: 'web-android',
  IOS_APP: 'iOS-app',
  API_OTHER: 'API-other',
  UNKNOWN: 'unknown',
} as const

export type AnalyticsPlatformValue =
  (typeof AnalyticsPlatform)[keyof typeof AnalyticsPlatform]

/**
 * Detect the platform from a request's headers
 */
export function detectPlatform(request: NextRequest): AnalyticsPlatformValue {
  // Defensive check for missing headers (can happen in test environments)
  if (!request?.headers?.get) {
    return AnalyticsPlatform.UNKNOWN
  }

  const userAgent = request.headers.get('user-agent') || ''
  const xPlatform = request.headers.get('x-platform')
  const authorization = request.headers.get('authorization') || ''

  // iOS native app - check for custom header or user agent
  if (
    xPlatform === 'ios-app' ||
    userAgent.includes('AstridApp/') ||
    userAgent.includes(`${BRAND.appName}/`)
  ) {
    return AnalyticsPlatform.IOS_APP
  }

  // API calls via OAuth token (not web requests)
  // OAuth tokens start with 'astrid_' and typically come from programmatic access
  if (
    authorization.startsWith('Bearer astrid_') &&
    !userAgent.includes('Mozilla') &&
    !userAgent.includes('Safari')
  ) {
    return AnalyticsPlatform.API_OTHER
  }

  // Mobile web - iPhone/iPod
  if (/iPhone|iPod/.test(userAgent)) {
    return AnalyticsPlatform.WEB_IPHONE
  }

  // Mobile web - Android
  if (/Android/.test(userAgent)) {
    return AnalyticsPlatform.WEB_ANDROID
  }

  // Desktop browsers (anything with Mozilla/Safari/Chrome that's not mobile)
  if (
    userAgent.includes('Mozilla') ||
    userAgent.includes('Chrome') ||
    userAgent.includes('Safari') ||
    userAgent.includes('Firefox') ||
    userAgent.includes('Edge')
  ) {
    return AnalyticsPlatform.WEB_DESKTOP
  }

  // Unknown - fallback for unusual user agents
  return AnalyticsPlatform.UNKNOWN
}

/**
 * Track an analytics event
 * This is fire-and-forget - errors are logged but not thrown
 */
export async function trackAnalyticsEvent(
  userId: string,
  eventType: AnalyticsEventTypeValue,
  platform: AnalyticsPlatformValue,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    await prisma.analyticsEvent.create({
      data: {
        userId,
        eventType,
        platform,
        metadata: metadata as Prisma.InputJsonValue | undefined,
      },
    })
  } catch (error) {
    // Log but don't throw - analytics should never break the app
    log.error({ err: error }, 'Failed to track analytics event:')
  }
}

/**
 * Helper to track event from a request
 */
export async function trackEventFromRequest(
  request: NextRequest,
  userId: string,
  eventType: AnalyticsEventTypeValue,
  metadata?: Record<string, unknown>
): Promise<void> {
  const platform = detectPlatform(request)
  await trackAnalyticsEvent(userId, eventType, platform, metadata)
}

/**
 * Aggregate daily stats for a specific date
 * This is called by the cron job
 */
export async function aggregateDailyStats(date: Date): Promise<void> {
  // Normalize to start of day UTC
  const startOfDay = new Date(date)
  startOfDay.setUTCHours(0, 0, 0, 0)

  const endOfDay = new Date(startOfDay)
  endOfDay.setUTCDate(endOfDay.getUTCDate() + 1)

  // Get all events for this day
  const events = await prisma.analyticsEvent.findMany({
    where: {
      createdAt: {
        gte: startOfDay,
        lt: endOfDay,
      },
    },
    select: {
      userId: true,
      eventType: true,
      platform: true,
    },
  })

  if (events.length === 0) {
    // No events for this day - still create a record with zeros
    await prisma.analyticsDailyStats.upsert({
      where: { date: startOfDay },
      create: {
        date: startOfDay,
        dau: 0,
        wau: 0,
        mau: 0,
      },
      update: {
        dau: 0,
        wau: 0,
        mau: 0,
      },
    })
    return
  }

  // Calculate DAU - distinct users active that day
  const uniqueUserIds = new Set(events.map((e) => e.userId))
  const dau = uniqueUserIds.size

  // Calculate platform breakdown for DAU
  const usersByPlatform: Record<string, Set<string>> = {
    'web-desktop': new Set(),
    'web-iPhone': new Set(),
    'web-android': new Set(),
    'iOS-app': new Set(),
    'API-other': new Set(),
    unknown: new Set(),
  }

  for (const event of events) {
    if (usersByPlatform[event.platform]) {
      usersByPlatform[event.platform].add(event.userId)
    }
  }

  // Calculate event counts
  const eventCounts: Record<string, number> = {}
  for (const event of events) {
    eventCounts[event.eventType] = (eventCounts[event.eventType] || 0) + 1
  }

  // Calculate WAU - distinct users in trailing 7 days
  const sevenDaysAgo = new Date(startOfDay)
  sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 6) // -6 because we include today

  const wauUsers = await prisma.analyticsEvent.findMany({
    where: {
      createdAt: {
        gte: sevenDaysAgo,
        lt: endOfDay,
      },
    },
    select: {
      userId: true,
    },
    distinct: ['userId'],
  })
  const wau = wauUsers.length

  // Calculate MAU - distinct users in trailing 30 days
  const thirtyDaysAgo = new Date(startOfDay)
  thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 29) // -29 because we include today

  const mauUsers = await prisma.analyticsEvent.findMany({
    where: {
      createdAt: {
        gte: thirtyDaysAgo,
        lt: endOfDay,
      },
    },
    select: {
      userId: true,
    },
    distinct: ['userId'],
  })
  const mau = mauUsers.length

  // Upsert daily stats
  await prisma.analyticsDailyStats.upsert({
    where: { date: startOfDay },
    create: {
      date: startOfDay,
      dau,
      wau,
      mau,
      dauWebDesktop: usersByPlatform['web-desktop'].size,
      dauWebIPhone: usersByPlatform['web-iPhone'].size,
      dauWebAndroid: usersByPlatform['web-android'].size,
      dauIOSApp: usersByPlatform['iOS-app'].size,
      dauAPIOther: usersByPlatform['API-other'].size,
      dauUnknown: usersByPlatform['unknown'].size,
      taskCreated: eventCounts[AnalyticsEventType.TASK_CREATED] || 0,
      taskEdited: eventCounts[AnalyticsEventType.TASK_EDITED] || 0,
      taskCompleted: eventCounts[AnalyticsEventType.TASK_COMPLETED] || 0,
      taskDeleted: eventCounts[AnalyticsEventType.TASK_DELETED] || 0,
      commentAdded: eventCounts[AnalyticsEventType.COMMENT_ADDED] || 0,
      commentDeleted: eventCounts[AnalyticsEventType.COMMENT_DELETED] || 0,
      listAdded: eventCounts[AnalyticsEventType.LIST_ADDED] || 0,
      listEdited: eventCounts[AnalyticsEventType.LIST_EDITED] || 0,
      listDeleted: eventCounts[AnalyticsEventType.LIST_DELETED] || 0,
      settingsUpdated: eventCounts[AnalyticsEventType.SETTINGS_UPDATED] || 0,
    },
    update: {
      dau,
      wau,
      mau,
      dauWebDesktop: usersByPlatform['web-desktop'].size,
      dauWebIPhone: usersByPlatform['web-iPhone'].size,
      dauWebAndroid: usersByPlatform['web-android'].size,
      dauIOSApp: usersByPlatform['iOS-app'].size,
      dauAPIOther: usersByPlatform['API-other'].size,
      dauUnknown: usersByPlatform['unknown'].size,
      taskCreated: eventCounts[AnalyticsEventType.TASK_CREATED] || 0,
      taskEdited: eventCounts[AnalyticsEventType.TASK_EDITED] || 0,
      taskCompleted: eventCounts[AnalyticsEventType.TASK_COMPLETED] || 0,
      taskDeleted: eventCounts[AnalyticsEventType.TASK_DELETED] || 0,
      commentAdded: eventCounts[AnalyticsEventType.COMMENT_ADDED] || 0,
      commentDeleted: eventCounts[AnalyticsEventType.COMMENT_DELETED] || 0,
      listAdded: eventCounts[AnalyticsEventType.LIST_ADDED] || 0,
      listEdited: eventCounts[AnalyticsEventType.LIST_EDITED] || 0,
      listDeleted: eventCounts[AnalyticsEventType.LIST_DELETED] || 0,
      settingsUpdated: eventCounts[AnalyticsEventType.SETTINGS_UPDATED] || 0,
    },
  })
}

/**
 * Get aggregated stats for a date range
 */
export async function getAnalyticsStats(
  startDate: Date,
  endDate: Date
): Promise<
  Array<{
    date: Date
    dau: number
    wau: number
    mau: number
    dauWebDesktop: number
    dauWebIPhone: number
    dauWebAndroid: number
    dauIOSApp: number
    dauAPIOther: number
    dauUnknown: number
    taskCreated: number
    taskEdited: number
    taskCompleted: number
    taskDeleted: number
    commentAdded: number
    commentDeleted: number
    listAdded: number
    listEdited: number
    listDeleted: number
    settingsUpdated: number
  }>
> {
  return prisma.analyticsDailyStats.findMany({
    where: {
      date: {
        gte: startDate,
        lte: endDate,
      },
    },
    orderBy: {
      date: 'asc',
    },
  })
}

/** Stable display order for the interface (platform) breakdown. */
export const ANALYTICS_PLATFORM_ORDER: AnalyticsPlatformValue[] = [
  AnalyticsPlatform.WEB_DESKTOP,
  AnalyticsPlatform.WEB_IPHONE,
  AnalyticsPlatform.WEB_ANDROID,
  AnalyticsPlatform.IOS_APP,
  AnalyticsPlatform.API_OTHER,
  AnalyticsPlatform.UNKNOWN,
]

/** Stable display order for event metrics in the per-interface breakdown. */
export const ANALYTICS_EVENT_ORDER: AnalyticsEventTypeValue[] = [
  AnalyticsEventType.TASK_CREATED,
  AnalyticsEventType.TASK_COMPLETED,
  AnalyticsEventType.TASK_EDITED,
  AnalyticsEventType.TASK_DELETED,
  AnalyticsEventType.COMMENT_ADDED,
  AnalyticsEventType.COMMENT_DELETED,
  AnalyticsEventType.LIST_ADDED,
  AnalyticsEventType.LIST_EDITED,
  AnalyticsEventType.LIST_DELETED,
  AnalyticsEventType.SETTINGS_UPDATED,
]

export interface EventCountsByPlatformRow {
  platform: string
  eventType: string
  count: number
}

export interface EventCountsByPlatform {
  /** platform → eventType → count, zero-filled for every known platform/event. */
  byPlatform: Record<string, Record<string, number>>
  /** eventType → total across all platforms. */
  totalsByEvent: Record<string, number>
  /** platform → total across all events. */
  totalsByPlatform: Record<string, number>
}

/**
 * Pure transform from grouped (platform, eventType) counts into a fully
 * zero-filled breakdown. Unknown platforms/events are folded in too so the
 * admin view never silently drops data. Kept pure so it's testable without a DB.
 */
export function buildEventCountsByPlatform(
  rows: EventCountsByPlatformRow[]
): EventCountsByPlatform {
  // Seed with the known platforms/events so the table is stable and zero-filled.
  const platforms = new Set<string>(ANALYTICS_PLATFORM_ORDER)
  const events = new Set<string>(ANALYTICS_EVENT_ORDER)
  for (const row of rows) {
    platforms.add(row.platform)
    events.add(row.eventType)
  }

  const byPlatform: Record<string, Record<string, number>> = {}
  const totalsByEvent: Record<string, number> = {}
  const totalsByPlatform: Record<string, number> = {}

  for (const platform of platforms) {
    byPlatform[platform] = {}
    totalsByPlatform[platform] = 0
    for (const eventType of events) {
      byPlatform[platform][eventType] = 0
    }
  }
  for (const eventType of events) {
    totalsByEvent[eventType] = 0
  }

  for (const row of rows) {
    byPlatform[row.platform][row.eventType] += row.count
    totalsByEvent[row.eventType] += row.count
    totalsByPlatform[row.platform] += row.count
  }

  return { byPlatform, totalsByEvent, totalsByPlatform }
}

/**
 * Get event counts broken down by interface (platform) for a date range.
 *
 * Uses the per-event AnalyticsEvent rows (which already record `platform`),
 * so no new instrumentation or migration is required — the daily rollup only
 * stores per-platform DAU, not per-platform event counts.
 */
export async function getEventCountsByPlatform(
  startDate: Date,
  endDate: Date
): Promise<EventCountsByPlatform> {
  const grouped = await prisma.analyticsEvent.groupBy({
    by: ['platform', 'eventType'],
    where: {
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
    },
    _count: { _all: true },
  })

  const rows: EventCountsByPlatformRow[] = grouped.map((g) => ({
    platform: g.platform,
    eventType: g.eventType,
    count: g._count._all,
  }))

  return buildEventCountsByPlatform(rows)
}
