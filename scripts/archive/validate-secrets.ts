#!/usr/bin/env npx tsx
/**
 * Secrets Validation Script
 *
 * Validates that all secrets are correctly configured between:
 * - Astrid.cc (Vercel) - CLAUDE_REMOTE_WEBHOOK_SECRET, GITHUB_*, etc.
 * - Claude Code Remote (Fly.io) - ASTRID_WEBHOOK_SECRET, ANTHROPIC_API_KEY, GH_TOKEN
 * - GitHub - Webhook secrets, App credentials
 *
 * Run with: npx tsx scripts/validate-secrets.ts
 */

import dotenv from 'dotenv'
import path from 'path'
import crypto from 'crypto'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

interface ValidationResult {
  name: string
  status: 'pass' | 'fail' | 'warn' | 'skip'
  message: string
  details?: string
}

const results: ValidationResult[] = []

function log(result: ValidationResult) {
  const icon = {
    pass: '✅',
    fail: '❌',
    warn: '⚠️',
    skip: '⏭️'
  }[result.status]

  console.log(`${icon} ${result.name}: ${result.message}`)
  if (result.details) {
    console.log(`   ${result.details}`)
  }
  results.push(result)
}

// Generate webhook signature using the same algorithm as the production code
function generateWebhookSignature(payload: string, secret: string, timestamp: string): string {
  const signedPayload = `${timestamp}.${payload}`
  return crypto
    .createHmac('sha256', secret)
    .update(signedPayload, 'utf8')
    .digest('hex')
}

function generateWebhookHeaders(payload: string, secret: string, event: string): Record<string, string> {
  const timestamp = Date.now().toString()
  const signature = generateWebhookSignature(payload, secret, timestamp)

  return {
    'Content-Type': 'application/json',
    'X-Astrid-Signature': `sha256=${signature}`,
    'X-Astrid-Timestamp': timestamp,
    'X-Astrid-Event': event,
    'User-Agent': 'Astrid-Secrets-Validator/1.0'
  }
}

async function validateFlyioHealth(): Promise<ValidationResult> {
  try {
    const response = await fetch('https://astrid-claude-remote.fly.dev/health', {
      signal: AbortSignal.timeout(10000)
    })

    if (!response.ok) {
      return {
        name: 'Fly.io Health',
        status: 'fail',
        message: `HTTP ${response.status}`,
        details: await response.text()
      }
    }

    const data = await response.json()
    return {
      name: 'Fly.io Health',
      status: data.status === 'healthy' ? 'pass' : 'warn',
      message: `Status: ${data.status}`,
      details: `Providers: Claude=${data.providers?.claude}, Active sessions: ${data.activeSessions}`
    }
  } catch (error) {
    return {
      name: 'Fly.io Health',
      status: 'fail',
      message: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

async function validateWebhookSecret(): Promise<ValidationResult> {
  const secret = process.env.CLAUDE_REMOTE_WEBHOOK_SECRET

  if (!secret) {
    return {
      name: 'Webhook Secret',
      status: 'fail',
      message: 'CLAUDE_REMOTE_WEBHOOK_SECRET not set in .env.local'
    }
  }

  // Test by sending a signed webhook to Fly.io
  const testPayload = JSON.stringify({
    event: 'test.secrets_validation',
    timestamp: new Date().toISOString(),
    validator: 'validate-secrets.ts'
  })

  try {
    const headers = generateWebhookHeaders(testPayload, secret, 'test.ping')

    const response = await fetch('https://astrid-claude-remote.fly.dev/webhook', {
      method: 'POST',
      headers,
      body: testPayload,
      signal: AbortSignal.timeout(10000)
    })

    if (response.ok) {
      return {
        name: 'Webhook Secret',
        status: 'pass',
        message: 'Signature verified by Fly.io',
        details: `Secret length: ${secret.length} chars`
      }
    } else if (response.status === 401) {
      const error = await response.json().catch(() => ({}))
      return {
        name: 'Webhook Secret',
        status: 'fail',
        message: 'Signature verification failed',
        details: `Error: ${error.error || 'Secrets do not match between Vercel and Fly.io'}`
      }
    } else {
      return {
        name: 'Webhook Secret',
        status: 'warn',
        message: `HTTP ${response.status}`,
        details: await response.text()
      }
    }
  } catch (error) {
    return {
      name: 'Webhook Secret',
      status: 'fail',
      message: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

async function validateGitHubToken(): Promise<ValidationResult> {
  // Test the GitHub token by checking rate limit (doesn't consume quota)
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN

  if (!token) {
    return {
      name: 'GitHub Token (Local)',
      status: 'skip',
      message: 'No GITHUB_TOKEN or GH_TOKEN in .env.local'
    }
  }

  try {
    const response = await fetch('https://api.github.com/rate_limit', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'Astrid-Secrets-Validator'
      },
      signal: AbortSignal.timeout(10000)
    })

    if (response.ok) {
      const data = await response.json()
      return {
        name: 'GitHub Token (Local)',
        status: 'pass',
        message: 'Token valid',
        details: `Rate limit: ${data.rate.remaining}/${data.rate.limit}`
      }
    } else if (response.status === 401) {
      return {
        name: 'GitHub Token (Local)',
        status: 'fail',
        message: 'Token invalid or expired'
      }
    } else {
      return {
        name: 'GitHub Token (Local)',
        status: 'warn',
        message: `HTTP ${response.status}`
      }
    }
  } catch (error) {
    return {
      name: 'GitHub Token (Local)',
      status: 'fail',
      message: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

async function validateFlyioGitHubToken(): Promise<ValidationResult> {
  // Check if Fly.io's GH_TOKEN works by checking diagnostics endpoint
  try {
    const response = await fetch('https://astrid-claude-remote.fly.dev/diagnostics', {
      signal: AbortSignal.timeout(10000)
    })

    if (!response.ok) {
      return {
        name: 'GitHub Token (Fly.io)',
        status: 'warn',
        message: `Diagnostics endpoint returned ${response.status}`
      }
    }

    const data = await response.json()
    const ghStatus = data.cliTools?.gh

    if (ghStatus?.available) {
      return {
        name: 'GitHub Token (Fly.io)',
        status: 'pass',
        message: 'gh CLI authenticated',
        details: `GH_TOKEN: ${data.environment?.GH_TOKEN || 'configured'}`
      }
    } else {
      return {
        name: 'GitHub Token (Fly.io)',
        status: 'fail',
        message: 'gh CLI not available or not authenticated',
        details: ghStatus?.version || 'Check Fly.io diagnostics'
      }
    }
  } catch (error) {
    return {
      name: 'GitHub Token (Fly.io)',
      status: 'fail',
      message: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

async function validateAnthropicKey(): Promise<ValidationResult> {
  // Check if Fly.io has ANTHROPIC_API_KEY configured
  try {
    const response = await fetch('https://astrid-claude-remote.fly.dev/health', {
      signal: AbortSignal.timeout(10000)
    })

    if (!response.ok) {
      return {
        name: 'Anthropic API Key (Fly.io)',
        status: 'fail',
        message: `Health check failed: ${response.status}`
      }
    }

    const data = await response.json()

    if (data.anthropicApiKey?.includes('set')) {
      return {
        name: 'Anthropic API Key (Fly.io)',
        status: 'pass',
        message: 'API key configured',
        details: data.anthropicApiKey
      }
    } else {
      return {
        name: 'Anthropic API Key (Fly.io)',
        status: 'fail',
        message: 'API key not set',
        details: data.anthropicApiKey
      }
    }
  } catch (error) {
    return {
      name: 'Anthropic API Key (Fly.io)',
      status: 'fail',
      message: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

async function validateClaudeCodeCLI(): Promise<ValidationResult> {
  try {
    const response = await fetch('https://astrid-claude-remote.fly.dev/diagnostics', {
      signal: AbortSignal.timeout(10000)
    })

    if (!response.ok) {
      return {
        name: 'Claude Code CLI (Fly.io)',
        status: 'warn',
        message: `Diagnostics endpoint returned ${response.status}`
      }
    }

    const data = await response.json()
    const claudeStatus = data.cliTools?.claude

    if (claudeStatus?.available) {
      return {
        name: 'Claude Code CLI (Fly.io)',
        status: 'pass',
        message: 'CLI available',
        details: `Version: ${claudeStatus.version}`
      }
    } else {
      return {
        name: 'Claude Code CLI (Fly.io)',
        status: 'fail',
        message: 'CLI not available',
        details: claudeStatus?.version || 'Check Fly.io diagnostics'
      }
    }
  } catch (error) {
    return {
      name: 'Claude Code CLI (Fly.io)',
      status: 'fail',
      message: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

async function validateOAuthCredentials(): Promise<ValidationResult> {
  const clientId = process.env.ASTRID_OAUTH_CLIENT_ID
  const clientSecret = process.env.ASTRID_OAUTH_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    return {
      name: 'Astrid OAuth Credentials',
      status: 'skip',
      message: 'ASTRID_OAUTH_CLIENT_ID or ASTRID_OAUTH_CLIENT_SECRET not set'
    }
  }

  try {
    const baseUrl = process.env.ASTRID_API_URL || 'https://astrid.cc'
    const response = await fetch(`${baseUrl}/api/v1/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'tasks:read'
      }),
      signal: AbortSignal.timeout(10000)
    })

    if (response.ok) {
      const data = await response.json()
      return {
        name: 'Astrid OAuth Credentials',
        status: 'pass',
        message: 'OAuth token obtained',
        details: `Token type: ${data.token_type}, expires in: ${data.expires_in}s`
      }
    } else {
      const error = await response.text()
      return {
        name: 'Astrid OAuth Credentials',
        status: 'fail',
        message: `OAuth failed: ${response.status}`,
        details: error
      }
    }
  } catch (error) {
    return {
      name: 'Astrid OAuth Credentials',
      status: 'fail',
      message: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

async function validateVercelWebhookUrl(): Promise<ValidationResult> {
  const webhookUrl = process.env.CLAUDE_REMOTE_WEBHOOK_URL

  if (!webhookUrl) {
    return {
      name: 'Webhook URL Config',
      status: 'warn',
      message: 'CLAUDE_REMOTE_WEBHOOK_URL not set in .env.local',
      details: 'This should be https://astrid-claude-remote.fly.dev/webhook'
    }
  }

  if (!webhookUrl.includes('astrid-claude-remote.fly.dev')) {
    return {
      name: 'Webhook URL Config',
      status: 'warn',
      message: 'URL does not point to expected Fly.io endpoint',
      details: `Current: ${webhookUrl}`
    }
  }

  return {
    name: 'Webhook URL Config',
    status: 'pass',
    message: 'URL correctly configured',
    details: webhookUrl
  }
}

async function validateAstridProduction(): Promise<ValidationResult> {
  try {
    const response = await fetch('https://astrid.cc/api/health', {
      signal: AbortSignal.timeout(10000)
    })

    if (response.ok) {
      const data = await response.json()
      return {
        name: 'Astrid Production',
        status: 'pass',
        message: 'API healthy',
        details: `Build: ${data.buildTimestamp || 'unknown'}`
      }
    } else {
      return {
        name: 'Astrid Production',
        status: 'fail',
        message: `HTTP ${response.status}`
      }
    }
  } catch (error) {
    return {
      name: 'Astrid Production',
      status: 'fail',
      message: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

async function main() {
  console.log('🔐 Secrets Validation\n')
  console.log('Checking all secrets and integrations between Astrid.cc, Fly.io, and GitHub...\n')
  console.log('═'.repeat(70) + '\n')

  // Run all validations
  console.log('📡 Service Health\n')
  log(await validateAstridProduction())
  log(await validateFlyioHealth())

  console.log('\n🔑 Webhook & API Secrets\n')
  log(await validateWebhookSecret())
  log(await validateVercelWebhookUrl())
  log(await validateOAuthCredentials())

  console.log('\n🐙 GitHub Integration\n')
  log(await validateGitHubToken())
  log(await validateFlyioGitHubToken())

  console.log('\n🤖 AI Services\n')
  log(await validateAnthropicKey())
  log(await validateClaudeCodeCLI())

  // Summary
  console.log('\n' + '═'.repeat(70))
  console.log('\n📊 Summary\n')

  const passed = results.filter(r => r.status === 'pass').length
  const failed = results.filter(r => r.status === 'fail').length
  const warned = results.filter(r => r.status === 'warn').length
  const skipped = results.filter(r => r.status === 'skip').length

  console.log(`   ✅ Passed:  ${passed}`)
  console.log(`   ❌ Failed:  ${failed}`)
  console.log(`   ⚠️  Warned:  ${warned}`)
  console.log(`   ⏭️  Skipped: ${skipped}`)

  if (failed > 0) {
    console.log('\n❌ Some validations failed. Please fix the issues above.')
    process.exit(1)
  } else if (warned > 0) {
    console.log('\n⚠️  All critical validations passed, but some warnings require attention.')
    process.exit(0)
  } else {
    console.log('\n✅ All validations passed!')
    process.exit(0)
  }
}

main().catch(console.error)
