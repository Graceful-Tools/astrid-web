/**
 * GET /api/admin/waiting-report — the Waiting settle job's DRY-RUN report (Jon, 2026-11-12).
 *
 * Admin only (lib/admin-auth.ts), by session or OAuth token. Always a dry run, whatever
 * WAITING_SETTLE_MODE / WAITING_BACKFILL_MODE say: it plans exactly what the scheduled job
 * (/api/cron/waiting-settle) would do and writes nothing. The answer has counts for every board,
 * and identifiers and titles only for tasks on boards the asking admin owns.
 *
 *   ?enforcement=enforce   plan as if WAITING_ENFORCE_NATIVE were "enforce" (default: the env's)
 */
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { AdminAuthError, requireAdmin } from '@/lib/admin-auth'
import { backfillModeFrom, nativeEnforcementFrom, settleModeFrom } from '@/lib/waiting-enforcement'
import { runWaitingSettleJob } from '@/services/waiting-settle-job'

export const maxDuration = 60

export const GET = withAuth({ scopes: ['tasks:read'], tag: 'admin.waiting-report' }, async (req, auth) => {
  try {
    await requireAdmin(auth.userId)
  } catch (error) {
    if (error instanceof AdminAuthError) return NextResponse.json({ error: error.message }, { status: 403 })
    throw error
  }

  const enforcement = new URL(req.url).searchParams.get('enforcement')
  const report = await runWaitingSettleJob({
    settleMode: 'dry-run',
    backfillMode: 'dry-run',
    nativeEnforcement: enforcement ? nativeEnforcementFrom(enforcement) : undefined,
    readerId: auth.userId,
  })

  return NextResponse.json({
    ...report,
    // What the scheduled job is configured to do, beside what this report planned.
    configured: { settleMode: settleModeFrom(), backfillMode: backfillModeFrom(), nativeEnforcement: nativeEnforcementFrom() },
    detailScope: { boardsOwnedBy: auth.user?.email ?? auth.userId },
  })
})
