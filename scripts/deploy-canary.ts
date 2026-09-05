#!/usr/bin/env tsx

/**
 * Deployment Canary Script
 *
 * Verifies production health after deployment by:
 * 1. Polling the /api/health endpoint
 * 2. Checking for expected response structure
 * 3. Measuring response times
 * 4. Auto-rollback or alert if unhealthy
 *
 * Usage:
 *   npm run deploy:canary                    # Check production
 *   npm run deploy:canary -- --url <URL>     # Check specific URL
 *   npm run deploy:canary -- --retries 5     # Custom retry count
 */

import { loadScriptEnv } from './lib/load-env'

loadScriptEnv()

interface HealthResponse {
  status: 'healthy' | 'unhealthy'
  timestamp: string
  database: {
    healthy: boolean
    responseTime: string
    error?: string
  }
  environment: string
  version: string
  cronSecretConfigured?: boolean
}

interface CanaryResult {
  healthy: boolean
  checks: number
  successfulChecks: number
  avgResponseTime: number
  lastError?: string
  details: CheckDetail[]
}

interface CheckDetail {
  timestamp: string
  healthy: boolean
  responseTime: number
  statusCode: number
  error?: string
}

// Configuration
const CONFIG = {
  productionUrl: process.env.NEXT_PUBLIC_APP_URL || 'https://astrid.cc',
  healthEndpoint: '/api/health',
  maxRetries: 5,
  retryDelayMs: 5000,
  timeoutMs: 10000,
  successThreshold: 0.8, // 80% of checks must pass
  maxResponseTimeMs: 5000, // Alert if avg response > 5s
}

class DeploymentCanary {
  private url: string
  private results: CheckDetail[] = []

  constructor(url?: string) {
    this.url = url || CONFIG.productionUrl
  }

  /**
   * Perform a single health check
   */
  private async checkHealth(): Promise<CheckDetail> {
    const startTime = Date.now()
    const timestamp = new Date().toISOString()

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), CONFIG.timeoutMs)

      const response = await fetch(`${this.url}${CONFIG.healthEndpoint}`, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Astrid-Canary/1.0',
        },
      })

      clearTimeout(timeout)

      const responseTime = Date.now() - startTime

      if (!response.ok) {
        return {
          timestamp,
          healthy: false,
          responseTime,
          statusCode: response.status,
          error: `HTTP ${response.status}`,
        }
      }

      const data: HealthResponse = await response.json()

      // A deployment whose CRON_SECRET is unset serves perfectly healthy pages
      // while every scheduled job 401s: no reminders, no digests, no analytics,
      // no GitHub sync, and no error anywhere. Production ran that way for
      // weeks (task a5eb65a4). It is not a database fault, so it warns here
      // rather than failing the canary into a rollback.
      if (data.cronSecretConfigured === false) {
        console.warn(
          '   ⚠️  CRON_SECRET is not set on this deployment — every scheduled job will 401. ' +
            'Set it in the Vercel project env and redeploy.',
        )
      }

      return {
        timestamp,
        healthy: data.status === 'healthy' && data.database?.healthy === true,
        responseTime,
        statusCode: response.status,
        error: data.database?.error,
      }
    } catch (error: any) {
      const responseTime = Date.now() - startTime

      return {
        timestamp,
        healthy: false,
        responseTime,
        statusCode: 0,
        error: error.name === 'AbortError' ? 'Timeout' : error.message,
      }
    }
  }

  /**
   * Wait for specified milliseconds
   */
  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Run canary checks with retries
   */
  async run(retries: number = CONFIG.maxRetries): Promise<CanaryResult> {
    console.log('🐤 Deployment Canary Starting...')
    console.log(`   Target: ${this.url}${CONFIG.healthEndpoint}`)
    console.log(`   Checks: ${retries}`)
    console.log(`   Delay: ${CONFIG.retryDelayMs}ms between checks`)
    console.log('')

    this.results = []

    for (let i = 1; i <= retries; i++) {
      console.log(`Check ${i}/${retries}...`)

      const result = await this.checkHealth()
      this.results.push(result)

      const icon = result.healthy ? '✅' : '❌'
      console.log(`   ${icon} ${result.healthy ? 'Healthy' : 'Unhealthy'} (${result.responseTime}ms)`)

      if (result.error) {
        console.log(`      Error: ${result.error}`)
      }

      // Wait between checks (except for last one)
      if (i < retries) {
        await this.delay(CONFIG.retryDelayMs)
      }
    }

    return this.analyzeResults()
  }

  /**
   * Analyze all check results
   */
  private analyzeResults(): CanaryResult {
    const successfulChecks = this.results.filter((r) => r.healthy).length
    const totalChecks = this.results.length
    const successRate = totalChecks > 0 ? successfulChecks / totalChecks : 0

    const avgResponseTime =
      this.results.reduce((sum, r) => sum + r.responseTime, 0) / totalChecks

    const lastError = this.results
      .filter((r) => r.error)
      .slice(-1)[0]?.error

    const healthy = successRate >= CONFIG.successThreshold

    return {
      healthy,
      checks: totalChecks,
      successfulChecks,
      avgResponseTime: Math.round(avgResponseTime),
      lastError,
      details: this.results,
    }
  }

  /**
   * Print summary report
   */
  printSummary(result: CanaryResult): void {
    console.log('\n' + '═'.repeat(50))
    console.log('📊 CANARY RESULTS')
    console.log('═'.repeat(50))

    console.log(`\nTarget: ${this.url}`)
    console.log(`Checks: ${result.successfulChecks}/${result.checks} passed`)
    console.log(`Success Rate: ${((result.successfulChecks / result.checks) * 100).toFixed(1)}%`)
    console.log(`Avg Response Time: ${result.avgResponseTime}ms`)

    if (result.lastError) {
      console.log(`Last Error: ${result.lastError}`)
    }

    console.log('\n' + '═'.repeat(50))

    if (result.healthy) {
      console.log('🎉 DEPLOYMENT HEALTHY')

      if (result.avgResponseTime > CONFIG.maxResponseTimeMs) {
        console.log(`⚠️  Warning: Response time (${result.avgResponseTime}ms) exceeds threshold (${CONFIG.maxResponseTimeMs}ms)`)
      }
    } else {
      console.log('🚨 DEPLOYMENT UNHEALTHY')
      console.log(`\nThreshold: ${CONFIG.successThreshold * 100}% of checks must pass`)
      console.log(`Actual: ${((result.successfulChecks / result.checks) * 100).toFixed(1)}%`)
    }

    console.log('═'.repeat(50) + '\n')
  }

  /**
   * Get OAuth token for Astrid API
   */
  private async getAstridToken(): Promise<string | null> {
    const clientId = process.env.ASTRID_OAUTH_CLIENT_ID
    const clientSecret = process.env.ASTRID_OAUTH_CLIENT_SECRET

    if (!clientId || !clientSecret) return null

    try {
      const response = await fetch('https://astrid.cc/api/v1/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
        }),
      })

      if (!response.ok) return null

      const { access_token } = await response.json()
      return access_token
    } catch {
      return null
    }
  }

  /**
   * Create an Astrid task for unhealthy deployment
   */
  async createAlertTask(result: CanaryResult): Promise<string | null> {
    const token = await this.getAstridToken()
    if (!token) {
      console.log('\n⚠️  Astrid OAuth not configured - cannot create alert task')
      return null
    }

    const listId = process.env.ASTRID_BUGS_LIST_ID || 'a623f322-4c3c-49b5-8a94-d2d9f00c82ba'

    const title = `🚨 Production Unhealthy: Canary Failed`
    const description = `## Deployment Canary Alert

**Generated**: ${new Date().toISOString()}
**Target**: ${this.url}

### Results

- **Checks**: ${result.successfulChecks}/${result.checks} passed
- **Success Rate**: ${((result.successfulChecks / result.checks) * 100).toFixed(1)}%
- **Avg Response Time**: ${result.avgResponseTime}ms
- **Last Error**: ${result.lastError || 'None'}

### Check Details

${result.details
  .map(
    (d) =>
      `- ${d.timestamp}: ${d.healthy ? '✅' : '❌'} ${d.responseTime}ms ${d.error ? `(${d.error})` : ''}`
  )
  .join('\n')}

### Action Items

- [ ] Check Vercel deployment logs
- [ ] Verify database connectivity
- [ ] Check for recent code changes
- [ ] Consider rollback if needed

---
*Created by Deployment Canary Script*`

    try {
      const response = await fetch('https://astrid.cc/api/v1/tasks', {
        method: 'POST',
        headers: {
          'X-OAuth-Token': token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          listId,
          title,
          description,
          priority: 3, // High priority
        }),
      })

      if (!response.ok) {
        console.error(`\n❌ Failed to create alert task: ${response.status}`)
        return null
      }

      const data = await response.json()
      const taskId = data.task?.id || data.id

      console.log(`\n📝 Created alert task: ${taskId}`)
      console.log(`   View at: https://astrid.cc/task/${taskId}`)

      return taskId
    } catch (error) {
      console.error('\n❌ Error creating alert task:', error)
      return null
    }
  }
}

// CLI entry point
async function main() {
  const args = process.argv.slice(2)

  // Parse arguments
  let url: string | undefined
  let retries = CONFIG.maxRetries

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) {
      url = args[i + 1]
      i++
    } else if (args[i] === '--retries' && args[i + 1]) {
      retries = parseInt(args[i + 1], 10)
      i++
    }
  }

  const canary = new DeploymentCanary(url)
  const result = await canary.run(retries)

  canary.printSummary(result)

  // Create task if unhealthy
  if (!result.healthy) {
    await canary.createAlertTask(result)
    process.exit(1)
  }
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})

export { DeploymentCanary, CONFIG }
