import { NextRequest, NextResponse } from "next/server"
import { safeHealthCheck, ensureMigrations } from "@/lib/runtime-migrations"
import { createLogger } from '@/lib/logger'
import { listPermissionsCoreStatus } from '@/lib/core-rules/list-permissions-core'
import { searchQueryCoreStatus } from '@/lib/core-rules/search-query-core'
import { repeatingCoreStatus } from '@/lib/core-rules/repeating-core'
import { boardCoreStatus } from '@/lib/core-rules/board-core'
import { waitingCoreStatus } from '@/lib/core-rules/waiting-core'
import { waitingEnforcementStatus } from '@/lib/waiting-enforcement'

const log = createLogger('health')

function getDeployedCommitSha(): string {
  return (
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GIT_COMMIT_SHA ||
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
    'unknown'
  )
}

export async function GET(request: NextRequest) {
  try {
    // Ensure migrations are applied (runtime fallback)
    await ensureMigrations()
    
    // Perform database health check
    const healthCheck = await safeHealthCheck()
    const commitSha = getDeployedCommitSha()
    // Since ADEV-304 astrid-core is the only list-permissions rule: a process without it refuses
    // every permission check. instrumentation.ts fails the boot first; this is the backstop.
    const coreRules = listPermissionsCoreStatus()
    const permissionsHealthy = coreRules?.loaded === true
    const healthy = healthCheck.healthy && permissionsHealthy

    const response = {
      status: healthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      database: {
        healthy: healthCheck.healthy,
        responseTime: `${healthCheck.responseTime}ms`,
        // The raw Prisma message can name the database host (AWTD-1456); it is
        // already in the server log via safeHealthCheck. Say only that it failed.
        ...(healthCheck.error && { error: 'Database health check failed' })
      },
      environment: process.env.NODE_ENV,
      version: commitSha,
      commitSha,
      buildTimestamp: commitSha,
      buildTime: commitSha,
      // Legacy-API census: middleware.ts drops every beacon when this is
      // unset, with no log and no external symptom (the beacon 401s the same
      // way for a wrong secret). This is the one observable answer.
      legacyCensusConfigured: !!process.env.INTERNAL_API_SECRET,
      // Same class of silence: every cron route fails closed without
      // CRON_SECRET (lib/cron-auth.ts), and Vercel only sends the Bearer
      // header when the variable exists — so a missing secret 401s all five
      // scheduled jobs forever with no reminders, digests or analytics and no
      // error anyone sees. Production ran that way from 2026-08-19 until a log
      // review found it. This flag is what makes it observable (task a5eb65a4).
      cronSecretConfigured: !!process.env.CRON_SECRET,
      // Whether astrid-core decides list permissions in this process (AWTD-1061). Since ADEV-304
      // there is no TypeScript fallback, so `loaded: false` (or null: never installed) makes this
      // endpoint unhealthy. stats are { answered, skipped, failed }; `failed` checks were refused.
      coreRules,
      // The same for search-query parsing (AWTD-1062), also retired.
      coreRulesSearch: searchQueryCoreStatus(),
      // And for repeating-task rollover on completion (AWTD-1063), also retired.
      coreRulesRepeating: repeatingCoreStatus(),
      // And for the project board (AWTD-1585): stats.columns (retired) and stats.drops (still compared).
      coreRulesBoard: boardCoreStatus(),
      // And for the Waiting lane (Jon, 2026-11-12).
      coreRulesWaiting: waitingCoreStatus(),
      // How often a native client's condition-less move into Waiting was let through
      // (WAITING_ENFORCE_NATIVE=lenient) — the number that says when enforcing is safe.
      waitingEnforcement: waitingEnforcementStatus(),
      webhookConfigured: !!process.env.CLAUDE_REMOTE_WEBHOOK_URL,
      // Booleans only: this endpoint is unauthenticated, and it once returned the first 30
      // characters of the secret-bearing CLAUDE_REMOTE_WEBHOOK_URL (AWTD-1456).
      webhookSecretConfigured: !!process.env.CLAUDE_REMOTE_WEBHOOK_SECRET,
    }

    return NextResponse.json(response, {
      status: healthy ? 200 : 503
    })
  } catch (error) {
    log.error({ err: error }, 'Health check failed:')
    
    return NextResponse.json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Health check failed',
      environment: process.env.NODE_ENV,
      version: getDeployedCommitSha(),
      commitSha: getDeployedCommitSha(),
    }, { 
      status: 503 
    })
  }
}