#!/usr/bin/env tsx

/**
 * Validate MCP OAuth Configuration
 *
 * This script validates that your MCP OAuth setup is correctly configured
 * and can successfully connect to the Astrid API.
 *
 * Usage:
 *   npm run validate:mcp:oauth
 *   or
 *   tsx scripts/validate-mcp-oauth.ts
 */

import path from 'path'
import fs from 'fs'
import { loadScriptEnv } from './lib/load-env'

loadScriptEnv()

interface ValidationResult {
  success: boolean
  message: string
  details?: string
}

interface OAuthTokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  scope: string
}

async function validateEnvironmentVariables(): Promise<ValidationResult> {
  console.log('📋 Validating environment variables...\n')

  const required = [
    { key: 'ASTRID_OAUTH_CLIENT_ID', description: 'OAuth Client ID' },
    { key: 'ASTRID_OAUTH_CLIENT_SECRET', description: 'OAuth Client Secret' },
  ]

  const optional = [
    {
      key: 'ASTRID_OAUTH_LIST_ID',
      description: 'Default List ID',
      default: 'Not set (must provide listId in each call)',
    },
    {
      key: 'ASTRID_API_BASE_URL',
      description: 'API Base URL',
      default: 'https://astrid.cc',
    },
  ]

  let allValid = true
  const details: string[] = []

  // Check required variables
  for (const { key, description } of required) {
    const value = process.env[key]
    if (value) {
      details.push(`✅ ${description} (${key}): ${value.substring(0, 20)}...`)
    } else {
      details.push(`❌ ${description} (${key}): MISSING`)
      allValid = false
    }
  }

  // Check optional variables
  for (const { key, description, default: defaultValue } of optional) {
    const value = process.env[key]
    if (value) {
      details.push(`✅ ${description} (${key}): ${value}`)
    } else {
      details.push(`ℹ️  ${description} (${key}): ${defaultValue}`)
    }
  }

  if (allValid) {
    return {
      success: true,
      message: 'Environment variables configured correctly',
      details: details.join('\n'),
    }
  } else {
    return {
      success: false,
      message: 'Missing required environment variables',
      details: details.join('\n'),
    }
  }
}

async function validateOAuthConnection(): Promise<ValidationResult> {
  console.log('\n🔐 Testing OAuth connection...\n')

  const clientId = process.env.ASTRID_OAUTH_CLIENT_ID
  const clientSecret = process.env.ASTRID_OAUTH_CLIENT_SECRET
  const baseUrl = process.env.ASTRID_API_BASE_URL || 'https://astrid.cc'

  if (!clientId || !clientSecret) {
    return {
      success: false,
      message: 'Cannot test OAuth connection - credentials not configured',
    }
  }

  try {
    console.log(`   Connecting to: ${baseUrl}/api/v1/oauth/token`)

    const response = await fetch(`${baseUrl}/api/v1/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
    })

    if (!response.ok) {
      const error = await response.json()
      return {
        success: false,
        message: 'OAuth token request failed',
        details: `HTTP ${response.status}: ${error.error || response.statusText}`,
      }
    }

    const data: OAuthTokenResponse = await response.json()

    return {
      success: true,
      message: 'OAuth connection successful',
      details: `Token type: ${data.token_type}\nExpires in: ${data.expires_in}s\nScopes: ${data.scope}`,
    }
  } catch (error) {
    return {
      success: false,
      message: 'OAuth connection error',
      details: error instanceof Error ? error.message : String(error),
    }
  }
}

async function validateListAccess(): Promise<ValidationResult> {
  console.log('\n📋 Testing list access...\n')

  const clientId = process.env.ASTRID_OAUTH_CLIENT_ID
  const clientSecret = process.env.ASTRID_OAUTH_CLIENT_SECRET
  const listId = process.env.ASTRID_OAUTH_LIST_ID
  const baseUrl = process.env.ASTRID_API_BASE_URL || 'https://astrid.cc'

  if (!listId) {
    return {
      success: true,
      message: 'No default list configured (skipping list access test)',
      details: 'Set ASTRID_OAUTH_LIST_ID to test list access',
    }
  }

  if (!clientId || !clientSecret) {
    return {
      success: false,
      message: 'Cannot test list access - credentials not configured',
    }
  }

  try {
    // First, get access token
    console.log(`   Obtaining access token...`)
    const tokenResponse = await fetch(`${baseUrl}/api/v1/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
    })

    if (!tokenResponse.ok) {
      return {
        success: false,
        message: 'Failed to obtain access token',
      }
    }

    const tokenData: OAuthTokenResponse = await tokenResponse.json()
    const accessToken = tokenData.access_token

    // Try to access the list
    console.log(`   Testing access to list: ${listId}`)
    const listResponse = await fetch(`${baseUrl}/api/v1/lists`, {
      method: 'GET',
      headers: {
        'X-OAuth-Token': accessToken,
        'Content-Type': 'application/json',
      },
    })

    if (!listResponse.ok) {
      const error = await listResponse.json()
      return {
        success: false,
        message: 'Failed to access lists',
        details: `HTTP ${listResponse.status}: ${error.error || listResponse.statusText}`,
      }
    }

    const listsData = await listResponse.json()
    const lists = listsData.lists || []

    // Check if the configured list is accessible
    const targetList = lists.find((l: any) => l.id === listId)

    if (!targetList) {
      return {
        success: false,
        message: 'Configured list not accessible',
        details: `List ${listId} not found in accessible lists.\nAccessible lists:\n${lists.map((l: any) => `  - ${l.name} (${l.id})`).join('\n')}`,
      }
    }

    // Try to get tasks from the list
    console.log(`   Testing task access...`)
    const tasksResponse = await fetch(
      `${baseUrl}/api/v1/tasks?listId=${listId}&completed=false`,
      {
        method: 'GET',
        headers: {
          'X-OAuth-Token': accessToken,
          'Content-Type': 'application/json',
        },
      }
    )

    if (!tasksResponse.ok) {
      const error = await tasksResponse.json()
      return {
        success: false,
        message: 'Failed to access tasks',
        details: `HTTP ${tasksResponse.status}: ${error.error || tasksResponse.statusText}`,
      }
    }

    const tasksData = await tasksResponse.json()
    const taskCount = tasksData.tasks?.length || 0

    return {
      success: true,
      message: 'List access successful',
      details: `List: ${targetList.name}\nTasks: ${taskCount} uncompleted tasks found`,
    }
  } catch (error) {
    return {
      success: false,
      message: 'List access error',
      details: error instanceof Error ? error.message : String(error),
    }
  }
}

async function validateMCPServerBuild(): Promise<ValidationResult> {
  console.log('\n🔨 Checking MCP server build...\n')

  const mcpServerPath = path.join(process.cwd(), 'dist', 'mcp-server-oauth.js')
  const mcpExecutablePath = path.join(process.cwd(), 'mcp', 'astrid-mcp-oauth')

  const results: string[] = []

  if (fs.existsSync(mcpServerPath)) {
    results.push(`✅ MCP server compiled: ${mcpServerPath}`)
  } else {
    results.push(`❌ MCP server not built: ${mcpServerPath}`)
    results.push('   Run: npm run build:mcp:oauth')
  }

  if (fs.existsSync(mcpExecutablePath)) {
    results.push(`✅ MCP executable exists: ${mcpExecutablePath}`)
  } else {
    results.push(`ℹ️  MCP executable not found: ${mcpExecutablePath}`)
    results.push('   Run: npm run build:mcp:oauth')
  }

  const allExist = fs.existsSync(mcpServerPath)

  return {
    success: allExist,
    message: allExist ? 'MCP server built successfully' : 'MCP server not built',
    details: results.join('\n'),
  }
}

function printClaudeDesktopConfig() {
  console.log('\n📝 Claude Desktop Configuration:\n')
  console.log('Add this to your claude_desktop_config.json:\n')

  const config = {
    mcpServers: {
      'astrid-oauth': {
        command: 'node',
        args: [path.join(process.cwd(), 'dist', 'mcp-server-oauth.js')],
        env: {
          ASTRID_OAUTH_CLIENT_ID: process.env.ASTRID_OAUTH_CLIENT_ID || 'your_client_id',
          ASTRID_OAUTH_CLIENT_SECRET:
            process.env.ASTRID_OAUTH_CLIENT_SECRET || 'your_client_secret',
          ASTRID_OAUTH_LIST_ID: process.env.ASTRID_OAUTH_LIST_ID || 'your_list_id',
          ASTRID_API_BASE_URL: process.env.ASTRID_API_BASE_URL || 'https://astrid.cc',
        },
      },
    },
  }

  console.log(JSON.stringify(config, null, 2))

  console.log('\nConfiguration file locations:')
  console.log('  macOS:   ~/Library/Application Support/Claude/claude_desktop_config.json')
  console.log('  Windows: %APPDATA%\\Claude\\claude_desktop_config.json')
  console.log('  Linux:   ~/.config/Claude/claude_desktop_config.json')
}

async function main() {
  console.log('🚀 Astrid MCP OAuth Configuration Validator\n')
  console.log('=' .repeat(60))

  const results: ValidationResult[] = []

  // Validate environment variables
  results.push(await validateEnvironmentVariables())

  // Validate OAuth connection
  results.push(await validateOAuthConnection())

  // Validate list access
  results.push(await validateListAccess())

  // Check MCP server build
  results.push(await validateMCPServerBuild())

  // Print results
  console.log('\n' + '='.repeat(60))
  console.log('📊 Validation Results:\n')

  let allSuccess = true
  for (const result of results) {
    const icon = result.success ? '✅' : '❌'
    console.log(`${icon} ${result.message}`)
    if (result.details) {
      console.log(`   ${result.details.replace(/\n/g, '\n   ')}`)
    }
    console.log()

    if (!result.success) {
      allSuccess = false
    }
  }

  // Print Claude Desktop config
  printClaudeDesktopConfig()

  console.log('\n' + '='.repeat(60))

  if (allSuccess) {
    console.log('✅ All validations passed!')
    console.log('\n🎉 Your MCP OAuth configuration is ready to use!')
    console.log('\nNext steps:')
    console.log('  1. Copy the configuration above to your claude_desktop_config.json')
    console.log('  2. Restart Claude Desktop')
    console.log('  3. Test with: "Can you list my Astrid tasks?"')
  } else {
    console.log('❌ Some validations failed')
    console.log('\n🔧 Please fix the issues above and run validation again')
    console.log('\nCommon solutions:')
    console.log('  • Set OAuth credentials in .env.local')
    console.log('  • Run: npm run build:mcp:oauth')
    console.log('  • Check OAuth client settings at https://astrid.cc/settings/api-access')
    process.exit(1)
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('❌ Validation error:', error)
    process.exit(1)
  })
}

export { main as validateMCPOAuth }
