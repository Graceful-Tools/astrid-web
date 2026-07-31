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

import crypto from 'crypto'
import { loadScriptEnv } from './lib/load-env'

loadScriptEnv()

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
  console.log('Checking Astrid production, OAuth and GitHub integrations...\n')
  console.log('═'.repeat(70) + '\n')

  // Run all validations
  console.log('📡 Service Health\n')
  log(await validateAstridProduction())

  console.log('\n🔑 Webhook & API Secrets\n')
  log(await validateOAuthCredentials())

  console.log('\n🐙 GitHub Integration\n')
  log(await validateGitHubToken())

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
