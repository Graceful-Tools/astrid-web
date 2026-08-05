import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { deleteFile } from "@/lib/secure-storage"
import { sweepAbandonedUploads, ABANDONED_UPLOAD_GRACE_MS } from "@/lib/abandoned-uploads"
import { createLogger } from '@/lib/logger'

const log = createLogger('cron.abandoned-uploads')

/**
 * Abandoned Upload Sweep (task 276b3086)
 *
 * Runs daily (configured in vercel.json) to reclaim files uploaded for a
 * comment or chat message that was never sent — a tab closed mid-compose never
 * runs the client-side cleanup, so the row and blob would otherwise live
 * forever.
 *
 * What is eligible, and why it is this narrow, lives in lib/abandoned-uploads.
 * Daily is plenty: this is a storage leak, not a correctness bug.
 */
export async function GET(request: NextRequest) {
  try {
    // Verify the request is from Vercel cron
    const authHeader = request.headers.get("authorization")
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    log.info("🔄 Sweeping abandoned composer uploads...")
    const startTime = Date.now()

    const result = await sweepAbandonedUploads({
      prisma,
      deleteFile,
      now: new Date(),
    })

    const duration = Date.now() - startTime
    log.info(
      { ...result, graceHours: ABANDONED_UPLOAD_GRACE_MS / (60 * 60 * 1000) },
      `✅ Abandoned upload sweep completed in ${duration}ms`,
    )

    return NextResponse.json({
      success: true,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString(),
      ...result,
    })
  } catch (error) {
    log.error({ err: error }, "❌ Error in abandoned upload sweep:")
    return NextResponse.json(
      {
        error: "Abandoned upload sweep failed",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    )
  }
}
