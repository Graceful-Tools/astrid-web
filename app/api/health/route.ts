import { NextRequest, NextResponse } from "next/server"
import { safeHealthCheck, ensureMigrations } from "@/lib/runtime-migrations"
import { createLogger } from '@/lib/logger'
import { listPermissionsCoreStatus } from '@/lib/core-rules/list-permissions-core'

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
    
    const response = {
      status: healthCheck.healthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      database: {
        healthy: healthCheck.healthy,
        responseTime: `${healthCheck.responseTime}ms`,
        ...(healthCheck.error && { error: healthCheck.error })
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
      // Whether astrid-core decides list permissions in this process (AWTD-1061). The fallback is
      // silent by design — the TypeScript gives the same answers — so this is the one place a
      // deploy can see that the core did not load: { mode: 'decide', loaded: false }.
      coreRules: listPermissionsCoreStatus(),
      webhookConfigured: !!process.env.CLAUDE_REMOTE_WEBHOOK_URL,
      webhookSecretConfigured: !!process.env.CLAUDE_REMOTE_WEBHOOK_SECRET,
      webhookUrl: process.env.CLAUDE_REMOTE_WEBHOOK_URL ? `${process.env.CLAUDE_REMOTE_WEBHOOK_URL.slice(0, 30)}...` : null
    }

    return NextResponse.json(response, { 
      status: healthCheck.healthy ? 200 : 503 
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