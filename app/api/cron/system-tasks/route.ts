import { NextRequest, NextResponse } from "next/server"
import { createVerifyEmailTasksForUnverifiedUsers } from "@/lib/system-tasks"
import { createLogger } from '@/lib/logger'
import { requireCronSecret } from "@/lib/cron-auth"
import { runCronJob } from "@/lib/cron-observability"

const log = createLogger('cron.system-tasks')


/**
 * System Tasks Cron Job
 *
 * Runs weekly (configured in vercel.json) to:
 * - Create verify email tasks for unverified users who don't have one
 * - Other system task maintenance as needed
 */
export async function GET(request: NextRequest) {
  // Authorised before any logging, so a rejected run and a successful one do
  // not produce an identical first line and nothing else (task f74c9370).
  // Fails CLOSED: no CRON_SECRET configured means nobody gets in.
  const blocked = requireCronSecret(request)
  if (blocked) return blocked

  return runCronJob('system-tasks', async () => {
    const verifyEmailStats = await createVerifyEmailTasksForUnverifiedUsers()
    return { ...verifyEmailStats }
  })
}
