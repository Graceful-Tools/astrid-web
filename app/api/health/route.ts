import { NextRequest, NextResponse } from "next/server"
import { safeHealthCheck, ensureMigrations } from "@/lib/runtime-migrations"
import { createLogger } from '@/lib/logger'

const log = createLogger('health')


export async function GET(request: NextRequest) {
  try {
    // Ensure migrations are applied (runtime fallback)
    await ensureMigrations()
    
    // Perform database health check
    const healthCheck = await safeHealthCheck()
    
    const response = {
      status: healthCheck.healthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      database: {
        healthy: healthCheck.healthy,
        responseTime: `${healthCheck.responseTime}ms`,
        ...(healthCheck.error && { error: healthCheck.error })
      },
      environment: process.env.NODE_ENV,
      version: '1.0.0',
      buildTime: new Date().toISOString(), // Runtime timestamp for debugging
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
      version: '1.0.0'
    }, { 
      status: 503 
    })
  }
}