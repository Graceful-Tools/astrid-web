import { BRAND } from '@/lib/brand/config'
import { NextRequest, NextResponse } from "next/server"
import { getUnifiedSession } from "@/lib/session-utils"
import { requireAdmin, AdminAuthError } from '@/lib/admin-auth'
import { prisma } from "@/lib/prisma"
import { PushNotificationService } from "@/lib/push-notification-service"
import { z } from "zod"
import { createLogger } from '@/lib/logger'
import { createSafeErrorResponse } from '@/lib/logging/error-sanitizer'

const log = createLogger('debug.test-notifications')


const TestNotificationSchema = z.object({
  type: z.enum(["daily_digest", "push_notification"]),
  targetUserEmail: z.string().email().optional(),
})

// Track test requests per user per day
const testCounts = new Map<string, { date: string; count: number }>()

const MAX_TESTS_PER_DAY = 10
const TEST_DELAY_MINUTES = 5

export async function POST(request: NextRequest) {
  try {
    const session = await getUnifiedSession()
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { type, targetUserEmail } = TestNotificationSchema.parse(body)

    // Check rate limiting
    const today = new Date().toISOString().split('T')[0]
    const userKey = session.user.email
    const userTestData = testCounts.get(userKey)

    if (userTestData?.date === today && userTestData.count >= MAX_TESTS_PER_DAY) {
      return NextResponse.json({ 
        error: "Daily test limit reached", 
        limit: MAX_TESTS_PER_DAY,
        resetTime: "midnight UTC"
      }, { status: 429 })
    }

    // Update test count
    if (userTestData?.date === today) {
      userTestData.count += 1
    } else {
      testCounts.set(userKey, { date: today, count: 1 })
    }

    // Determine target user for the notification.
    // Non-admins may only test against themselves.
    let targetEmail = session.user.email
    if (targetUserEmail) {
      const callerEmail = session.user.email.toLowerCase()
      const requestedEmail = targetUserEmail.toLowerCase()
      if (requestedEmail !== callerEmail) {
        if (!session.user.id) {
          return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
        }
        try {
          await requireAdmin(session.user.id)
        } catch (error) {
          if (error instanceof AdminAuthError) {
            return NextResponse.json({ error: error.message }, { status: 403 })
          }
          throw error
        }
      }
      targetEmail = targetUserEmail
    }
    
    // Get target user settings
    const user = await prisma.user.findUnique({
      where: { email: targetEmail },
      select: {
        id: true,
        name: true,
        email: true,
        defaultDueTime: true,
      }
    })

    if (!user) {
      return NextResponse.json({ 
        error: `Target user not found: ${targetEmail}`,
        message: targetUserEmail ? `User ${targetUserEmail} does not exist` : "Current user not found"
      }, { status: 404 })
    }

    log.info(`🧪 Debug: Sending test notification to user ${user.email} (${user.id})`)

    // Schedule test notification with delay
    const testTime = new Date()
    testTime.setMinutes(testTime.getMinutes() + TEST_DELAY_MINUTES)

    if (type === "daily_digest") {
      // For testing, we'll simulate a daily digest email
      // In a real implementation, this would schedule an actual email
      const testTasks = await prisma.task.findMany({
        where: {
          assigneeId: user.id,
          completed: false,
        },
        take: 5,
        select: {
          id: true,
          title: true,
          dueDateTime: true,
          isAllDay: true,
          priority: true,
        }
      })

      return NextResponse.json({
        success: true,
        message: `Daily digest test scheduled for ${testTime.toLocaleTimeString()}`,
        type: "daily_digest",
        testsRemaining: MAX_TESTS_PER_DAY - (testCounts.get(userKey)?.count || 0),
        testData: {
          user: user.name || user.email,
          tasksCount: testTasks.length,
          scheduledTime: testTime.toISOString(),
          actualDigestTime: "08:00",
        }
      })

    } else if (type === "push_notification") {
      // Send actual push notification for testing
      try {
        // Check if VAPID keys are configured
        if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
          return NextResponse.json({
            success: false,
            error: "VAPID keys not configured",
            message: "Push notifications require VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY environment variables",
            testsRemaining: MAX_TESTS_PER_DAY - (testCounts.get(userKey)?.count || 0),
            debugInfo: {
              hasVapidPublic: !!process.env.VAPID_PUBLIC_KEY,
              hasVapidPrivate: !!process.env.VAPID_PRIVATE_KEY,
            }
          })
        }

        // Check if user has push subscriptions
        const subscriptions = await prisma.pushSubscription.findMany({
          where: {
            userId: user.id,
            isActive: true,
          },
        })

        if (subscriptions.length === 0) {
          return NextResponse.json({
            success: false,
            error: "No push subscriptions found",
            message: `User ${user.email} has no active push subscriptions. They need to enable notifications in their browser.`,
            testsRemaining: MAX_TESTS_PER_DAY - (testCounts.get(userKey)?.count || 0),
            debugInfo: {
              subscriptionsFound: 0,
              instruction: "User needs to: 1) Allow notifications in browser, 2) Register for push notifications via Service Worker"
            }
          })
        }

        const pushService = new PushNotificationService()
        await pushService.sendTestNotification(user.id)

        return NextResponse.json({
          success: true,
          message: `Push notification sent to ${user.email} (${subscriptions.length} subscription${subscriptions.length !== 1 ? 's' : ''})`,
          type: "push_notification",
          testsRemaining: MAX_TESTS_PER_DAY - (testCounts.get(userKey)?.count || 0),
          testData: {
            user: user.name || user.email,
            sentTime: new Date().toISOString(),
            notificationType: "test_reminder",
            message: `This is a test notification from ${BRAND.appName}`,
            subscriptionsUsed: subscriptions.length,
          }
        })
      } catch (error) {
        log.error({ err: error }, "Failed to send test push notification:")
        return NextResponse.json({
          success: false,
          ...createSafeErrorResponse(error, 'Failed to send push notification'),
          testsRemaining: MAX_TESTS_PER_DAY - (testCounts.get(userKey)?.count || 0),
        })
      }
    }

    return NextResponse.json({ error: "Invalid test type" }, { status: 400 })

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid data", details: error.errors }, { status: 400 })
    }
    
    log.error({ err: error }, "Error in test notifications:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}