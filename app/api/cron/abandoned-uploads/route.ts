import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { deleteFile } from "@/lib/secure-storage"
import {
  sweepAbandonedUploads,
  countAmbiguousLegacyUploads,
  ABANDONED_UPLOAD_GRACE_MS,
} from "@/lib/abandoned-uploads"
import { createLogger } from '@/lib/logger'
import { requireCronSecret } from "@/lib/cron-auth"

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
    // Verify the request is from Vercel cron. Fails CLOSED: no
    // CRON_SECRET configured means nobody gets in.
    const blocked = requireCronSecret(request)
    if (blocked) return blocked

    log.info("🔄 Sweeping abandoned composer uploads...")
    const startTime = Date.now()

    const result = await sweepAbandonedUploads({
      prisma,
      deleteFile,
      now: new Date(),
    })

    // Rows predating the discriminator cannot be swept — see
    // ambiguousLegacyWhere. Reporting the count turns the backlog into a number
    // someone can act on instead of an unmeasured caveat.
    const legacyAmbiguous = await countAmbiguousLegacyUploads(prisma)

    const duration = Date.now() - startTime
    log.info(
      { ...result, legacyAmbiguous, graceHours: ABANDONED_UPLOAD_GRACE_MS / (60 * 60 * 1000) },
      `✅ Abandoned upload sweep completed in ${duration}ms`,
    )

    return NextResponse.json({
      success: true,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString(),
      ...result,
      legacyAmbiguous,
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
