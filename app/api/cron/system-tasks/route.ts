import { NextRequest, NextResponse } from "next/server"
import { createVerifyEmailTasksForUnverifiedUsers } from "@/lib/system-tasks"
import { createLogger } from '@/lib/logger'
import { requireCronSecret } from "@/lib/cron-auth"

const log = createLogger('cron.system-tasks')


/**
 * System Tasks Cron Job
 *
 * Runs weekly (configured in vercel.json) to:
 * - Create verify email tasks for unverified users who don't have one
 * - Other system task maintenance as needed
 */
export async function GET(request: NextRequest) {
  try {
    log.info("🔄 Processing system tasks...")

    // Verify the request is from Vercel cron. Fails CLOSED: no
    // CRON_SECRET configured means nobody gets in.
    const blocked = requireCronSecret(request)
    if (blocked) return blocked

    const startTime = Date.now()

    // Create verify email tasks for all unverified users
    const verifyEmailStats = await createVerifyEmailTasksForUnverifiedUsers()

    const duration = Date.now() - startTime
    log.info(`✅ System tasks processing completed in ${duration}ms`)

    return NextResponse.json({
      success: true,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString(),
      verifyEmailTasks: verifyEmailStats,
    })
  } catch (error) {
    log.error({ err: error }, "❌ Error in system tasks cron job:")
    return NextResponse.json(
      {
        error: "System tasks processing failed",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    )
  }
}
