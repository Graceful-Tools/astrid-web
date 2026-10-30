#!/usr/bin/env npx tsx

/**
 * Pre-Production AI Agent Checklist
 * Comprehensive checks before deploying AI agent workflow to production
 */

import { createScriptPrisma } from './lib/script-prisma'

const prisma = createScriptPrisma()
const PROD_BASE_URL = 'https://astrid.cc'

interface CheckResult {
  name: string
  status: 'PASS' | 'FAIL' | 'WARNING'
  message: string
  fix?: string
}

class PreProductionChecker {
  private results: CheckResult[] = []

  private addCheck(name: string, status: 'PASS' | 'FAIL' | 'WARNING', message: string, fix?: string) {
    this.results.push({ name, status, message, fix })

    const icon = status === 'PASS' ? '✅' : status === 'WARNING' ? '⚠️' : '❌'
    console.log(`${icon} ${name}: ${message}`)
    if (fix) console.log(`   💡 Fix: ${fix}`)
  }

  async checkAIAgentConfiguration() {
    console.log('🔍 Checking AI Agent Configuration...\n')

    try {
      const aiAgent = await prisma.user.findFirst({
        where: {
          isAIAgent: true,
          aiAgentType: 'claude_agent'
        }
      })

      if (!aiAgent) {
        this.addCheck(
          'AI Agent Exists',
          'FAIL',
          'Claude AI agent not found in database',
          'Run: npm run create-ai-agent or manually create AI agent'
        )
        return
      }

      this.addCheck('AI Agent Exists', 'PASS', `Found: ${aiAgent.name}`)

      // Check webhook URL
      if (!aiAgent.webhookUrl) {
        this.addCheck(
          'Webhook URL',
          'FAIL',
          'AI agent has no webhook URL',
          'Set webhookUrl to: https://astrid.cc/api/ai-agent/webhook'
        )
      } else if (aiAgent.webhookUrl.includes('localhost')) {
        this.addCheck(
          'Webhook URL',
          'WARNING',
          'Webhook URL is set to localhost - will not work in production',
          'Update to: https://astrid.cc/api/ai-agent/webhook'
        )
      } else if (aiAgent.webhookUrl === `${PROD_BASE_URL}/api/ai-agent/webhook`) {
        this.addCheck('Webhook URL', 'PASS', `Correctly set: ${aiAgent.webhookUrl}`)
      } else {
        this.addCheck(
          'Webhook URL',
          'WARNING',
          `Unexpected webhook URL: ${aiAgent.webhookUrl}`,
          'Should be: https://astrid.cc/api/ai-agent/webhook'
        )
      }

      // Check MCP configuration
      if (!aiAgent.mcpEnabled) {
        this.addCheck(
          'MCP Enabled',
          'FAIL',
          'MCP is not enabled for AI agent',
          'Set mcpEnabled to true'
        )
      } else {
        this.addCheck('MCP Enabled', 'PASS', 'MCP is enabled')
      }

      // Check for MCP token
      const mcpToken = await prisma.mCPToken.findFirst({
        where: {
          userId: aiAgent.id,
          isActive: true
        }
      })

      if (!mcpToken) {
        this.addCheck(
          'MCP Token',
          'FAIL',
          'AI agent has no active MCP token',
          'Create MCP token for AI agent'
        )
      } else {
        this.addCheck('MCP Token', 'PASS', `Token exists: ${mcpToken.token.substring(0, 20)}...`)
      }

    } catch (error) {
      this.addCheck('AI Agent Configuration', 'FAIL', `Database error: ${error}`)
    }
  }

  async checkEnvironmentVariables() {
    console.log('\n🔍 Checking Environment Variables...\n')

    const requiredEnvVars = [
      'NEXT_PUBLIC_BASE_URL',
      'DATABASE_URL',
      'NEXTAUTH_SECRET'
    ]

    const optionalEnvVars = [
      'GITHUB_APP_ID',
      'GITHUB_APP_PRIVATE_KEY',
      'GITHUB_WEBHOOK_SECRET'
    ]

    requiredEnvVars.forEach(envVar => {
      if (!process.env[envVar]) {
        this.addCheck(
          `Environment Variable: ${envVar}`,
          'FAIL',
          'Required environment variable is missing',
          `Set ${envVar} in production environment`
        )
      } else {
        this.addCheck(`Environment Variable: ${envVar}`, 'PASS', 'Set')
      }
    })

    optionalEnvVars.forEach(envVar => {
      if (!process.env[envVar]) {
        this.addCheck(
          `Environment Variable: ${envVar}`,
          'WARNING',
          'Optional environment variable is missing (GitHub features may not work)',
          `Set ${envVar} for GitHub integration`
        )
      } else {
        this.addCheck(`Environment Variable: ${envVar}`, 'PASS', 'Set')
      }
    })

    // Check BASE_URL format
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL
    if (baseUrl && !baseUrl.startsWith('https://')) {
      this.addCheck(
        'BASE_URL Format',
        'WARNING',
        'BASE_URL should use HTTPS in production',
        'Set NEXT_PUBLIC_BASE_URL to https://astrid.cc'
      )
    }
  }

  async checkWebhookEndpoint() {
    console.log('\n🔍 Checking Webhook Endpoint...\n')

    try {
      // Test the webhook endpoint availability
      const response = await fetch(`${PROD_BASE_URL}/api/ai-agent/webhook`)

      if (response.ok) {
        const data = await response.json()
        if (data.service && data.service.includes('AI Agent')) {
          this.addCheck('Webhook Endpoint', 'PASS', 'Endpoint is accessible and responding')
        } else {
          this.addCheck('Webhook Endpoint', 'WARNING', 'Endpoint responds but may not be the correct service')
        }
      } else {
        this.addCheck(
          'Webhook Endpoint',
          'FAIL',
          `Endpoint not accessible: HTTP ${response.status}`,
          'Ensure /api/ai-agent/webhook is deployed and working'
        )
      }
    } catch (error) {
      this.addCheck(
        'Webhook Endpoint',
        'FAIL',
        `Network error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'Check if production site is accessible'
      )
    }
  }

  async checkDatabaseConnectivity() {
    console.log('\n🔍 Checking Database Connectivity...\n')

    try {
      await prisma.$connect()
      this.addCheck('Database Connection', 'PASS', 'Successfully connected to database')

      // Test a simple query
      const userCount = await prisma.user.count()
      this.addCheck('Database Query', 'PASS', `Query successful (${userCount} users)`)

      // Check for AI agent in production database
      const aiAgent = await prisma.user.count({
        where: { isAIAgent: true, aiAgentType: 'claude_agent' }
      })

      if (aiAgent === 0) {
        this.addCheck(
          'AI Agent in Database',
          'FAIL',
          'No Claude AI agent found in production database',
          'Create AI agent in production database'
        )
      } else {
        this.addCheck('AI Agent in Database', 'PASS', 'Claude AI agent found in production database')
      }

    } catch (error) {
      this.addCheck(
        'Database Connection',
        'FAIL',
        `Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'Check DATABASE_URL and database availability'
      )
    }
  }

  async checkSSEIntegration() {
    console.log('\n🔍 Checking SSE Integration...\n')

    try {
      // Test SSE health endpoint
      const response = await fetch(`${PROD_BASE_URL}/api/sse/health`)

      if (response.ok) {
        this.addCheck('SSE Health', 'PASS', 'SSE service is healthy')
      } else {
        this.addCheck(
          'SSE Health',
          'WARNING',
          `SSE health check failed: HTTP ${response.status}`,
          'Check SSE service configuration'
        )
      }
    } catch (error) {
      this.addCheck(
        'SSE Health',
        'WARNING',
        'Could not check SSE health (may still work)',
        'Verify SSE endpoints are accessible'
      )
    }
  }

  async checkRateLimiting() {
    console.log('\n🔍 Checking Rate Limiting...\n')

    // Check if rate limiting configuration exists
    try {
      const { RATE_LIMITS } = await import('@/lib/rate-limiter')

      if (RATE_LIMITS.WEBHOOK) {
        this.addCheck('Rate Limiting Config', 'PASS', 'Webhook rate limiting is configured')
      } else {
        this.addCheck(
          'Rate Limiting Config',
          'WARNING',
          'Webhook rate limiting may not be configured',
          'Verify rate limiting settings'
        )
      }
    } catch (error) {
      this.addCheck(
        'Rate Limiting Config',
        'WARNING',
        'Could not check rate limiting configuration'
      )
    }
  }

  async checkSecurityConfiguration() {
    console.log('\n🔍 Checking Security Configuration...\n')

    // Check if running in production mode
    const nodeEnv = process.env.NODE_ENV
    if (nodeEnv === 'production') {
      this.addCheck('Environment Mode', 'PASS', 'Running in production mode')
    } else {
      this.addCheck(
        'Environment Mode',
        'WARNING',
        `Running in ${nodeEnv} mode`,
        'Set NODE_ENV=production for production deployment'
      )
    }

    // Check NEXTAUTH_SECRET
    if (!process.env.NEXTAUTH_SECRET) {
      this.addCheck(
        'Auth Security',
        'FAIL',
        'NEXTAUTH_SECRET is not set',
        'Set NEXTAUTH_SECRET to a secure random string'
      )
    } else if (process.env.NEXTAUTH_SECRET.length < 32) {
      this.addCheck(
        'Auth Security',
        'WARNING',
        'NEXTAUTH_SECRET is too short',
        'Use a longer, more secure secret (32+ characters)'
      )
    } else {
      this.addCheck('Auth Security', 'PASS', 'NEXTAUTH_SECRET is properly configured')
    }
  }

  printSummary() {
    console.log('\n' + '='.repeat(60))
    console.log('📊 PRE-PRODUCTION CHECKLIST SUMMARY')
    console.log('='.repeat(60))

    const passed = this.results.filter(r => r.status === 'PASS').length
    const warnings = this.results.filter(r => r.status === 'WARNING').length
    const failed = this.results.filter(r => r.status === 'FAIL').length

    console.log(`✅ Passed: ${passed}`)
    console.log(`⚠️  Warnings: ${warnings}`)
    console.log(`❌ Failed: ${failed}`)

    if (failed > 0) {
      console.log('\n🚨 CRITICAL ISSUES - Must fix before production:')
      this.results
        .filter(r => r.status === 'FAIL')
        .forEach(r => {
          console.log(`   ❌ ${r.name}: ${r.message}`)
          if (r.fix) console.log(`      💡 ${r.fix}`)
        })
    }

    if (warnings > 0) {
      console.log('\n⚠️  WARNINGS - Recommended to fix:')
      this.results
        .filter(r => r.status === 'WARNING')
        .forEach(r => {
          console.log(`   ⚠️  ${r.name}: ${r.message}`)
          if (r.fix) console.log(`      💡 ${r.fix}`)
        })
    }

    console.log('\n🎯 DEPLOYMENT READINESS:')
    if (failed === 0 && warnings === 0) {
      console.log('🟢 READY FOR PRODUCTION - All checks passed!')
    } else if (failed === 0) {
      console.log('🟡 MOSTLY READY - Only warnings remain (recommended to fix)')
    } else {
      console.log('🔴 NOT READY - Critical issues must be fixed first')
    }

    console.log('\n📋 POST-DEPLOYMENT TESTING:')
    console.log('1. Create a test task in production')
    console.log('2. Assign it to "Claude Code Agent"')
    console.log('3. Verify AI agent responds with acknowledgment comment')
    console.log('4. Check for real-time SSE notifications')
    console.log('5. Verify task completion workflow')

    console.log('\n🔧 QUICK FIXES:')
    console.log('- Update webhook URL: npm run fix:ai-agent-webhook')
    console.log('- Test AI agent: npm run test:ai-agent')
    console.log('- Check logs: npm run logs:production')
  }

  async runAllChecks() {
    console.log('🧪 PRE-PRODUCTION AI AGENT CHECKLIST')
    console.log('='.repeat(60))

    await this.checkAIAgentConfiguration()
    await this.checkEnvironmentVariables()
    await this.checkWebhookEndpoint()
    await this.checkDatabaseConnectivity()
    await this.checkSSEIntegration()
    await this.checkRateLimiting()
    await this.checkSecurityConfiguration()

    this.printSummary()

    await prisma.$disconnect()

    // Exit with error code if critical issues found
    const failed = this.results.filter(r => r.status === 'FAIL').length
    if (failed > 0) {
      process.exit(1)
    }
  }
}

async function main() {
  const checker = new PreProductionChecker()
  await checker.runAllChecks()
}

if (require.main === module) {
  main().catch(console.error)
}

export { PreProductionChecker }