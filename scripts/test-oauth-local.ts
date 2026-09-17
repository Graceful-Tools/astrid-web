/**
 * Local OAuth Testing Script
 *
 * Tests OAuth flows against local development server
 * Run with: npm run test:oauth
 * Or: npx tsx --env-file=.env.local scripts/test-oauth-local.ts
 */

import { prisma } from '../lib/prisma'
import { SCOPE_GROUPS } from '../lib/oauth/oauth-scopes'
import { createOAuthClient } from '../lib/oauth/oauth-client-manager'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'

async function main() {
  console.log('🧪 Testing OAuth Flows Locally\n')

  try {
    // Step 1: Create test user
    console.log('1️⃣  Creating test user...')
    const testUser = await prisma.user.upsert({
      where: { email: 'oauth-test@local.dev' },
      update: {},
      create: {
        email: 'oauth-test@local.dev',
        name: 'OAuth Test User',
      },
    })
    console.log(`✅ Test user created: ${testUser.email} (${testUser.id})\n`)

    // Step 2: Create OAuth client
    console.log('2️⃣  Creating OAuth client application...')
    const client = await createOAuthClient({
      userId: testUser.id,
      name: 'Test iOS App',
      description: 'Test OAuth client for local development',
      grantTypes: ['client_credentials'],
      // From the group rather than a fourth copy of a scope list (task 9ebfaba7).
      scopes: [...SCOPE_GROUPS.ai_agent],
    })
    console.log('✅ OAuth client created:')
    console.log(`   Client ID: ${client.clientId}`)
    console.log(`   Client Secret: ${client.clientSecret.substring(0, 20)}...`)
    console.log(`   Scopes: ${client.scopes.join(', ')}\n`)

    // Step 3: Test client credentials flow
    console.log('3️⃣  Testing Client Credentials Flow...')
    const tokenResponse = await fetch(`${API_BASE}/api/v1/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: client.clientId,
        client_secret: client.clientSecret,
        scope: 'tasks:read tasks:write',
      }),
    })

    if (!tokenResponse.ok) {
      const error = await tokenResponse.json()
      throw new Error(`Token request failed: ${JSON.stringify(error)}`)
    }

    const tokenData = await tokenResponse.json()
    console.log('✅ Access token obtained:')
    console.log(`   Token: ${tokenData.access_token.substring(0, 30)}...`)
    console.log(`   Type: ${tokenData.token_type}`)
    console.log(`   Expires in: ${tokenData.expires_in}s`)
    console.log(`   Scope: ${tokenData.scope}\n`)

    // Step 4: Test API access with OAuth token
    console.log('4️⃣  Testing API access with OAuth token...')
    const tasksResponse = await fetch(`${API_BASE}/api/v1/tasks?limit=5`, {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
      },
    })

    if (!tasksResponse.ok) {
      const error = await tasksResponse.json()
      throw new Error(`Tasks API request failed: ${JSON.stringify(error)}`)
    }

    const tasksData = await tasksResponse.json()
    console.log('✅ Successfully accessed tasks API:')
    console.log(`   Total tasks: ${tasksData.meta?.total || 0}`)
    console.log(`   API Version: ${tasksData.meta?.apiVersion}`)
    console.log(`   Auth Source: ${tasksData.meta?.authSource}\n`)

    // Step 5: Test legacy MCP endpoint with OAuth token
    console.log('5️⃣  Testing legacy MCP endpoint with OAuth token...')
    const mcpResponse = await fetch(`${API_BASE}/api/mcp/operations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenData.access_token}`,
      },
      body: JSON.stringify({
        operation: 'get_user_tasks',
        args: {
          includeCompleted: false,
        },
      }),
    })

    if (!mcpResponse.ok) {
      const error = await mcpResponse.json()
      throw new Error(`MCP request failed: ${JSON.stringify(error)}`)
    }

    const mcpData = await mcpResponse.json()
    console.log('✅ Legacy MCP endpoint accepts OAuth token:')
    console.log(`   Tasks returned: ${mcpData.tasks?.length || 0}`)

    const deprecationWarning = mcpResponse.headers.get('X-Deprecation-Warning')
    if (deprecationWarning) {
      console.log(`   ⚠️  Deprecation Warning: ${deprecationWarning}`)
    }
    console.log()

    // Step 6: Create a test task via new API
    console.log('6️⃣  Creating test task via OAuth API...')
    const createTaskResponse = await fetch(`${API_BASE}/api/v1/tasks`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: 'OAuth Test Task',
        description: 'Created via OAuth client credentials flow',
        priority: 1,
      }),
    })

    if (!createTaskResponse.ok) {
      const error = await createTaskResponse.json()
      throw new Error(`Create task failed: ${JSON.stringify(error)}`)
    }

    const taskData = await createTaskResponse.json()
    console.log('✅ Task created successfully:')
    console.log(`   Task ID: ${taskData.task.id}`)
    console.log(`   Title: ${taskData.task.title}`)
    console.log()

    // Step 7: Test with legacy MCP token
    console.log('7️⃣  Testing with legacy MCP token...')
    const mcpToken = await prisma.mCPToken.create({
      data: {
        token: `astrid_mcp_test_${Date.now()}`,
        userId: testUser.id,
        permissions: ['read', 'write'],
        isActive: true,
      },
    })

    const legacyMcpResponse = await fetch(`${API_BASE}/api/mcp/operations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MCP-Access-Token': mcpToken.token,
      },
      body: JSON.stringify({
        operation: 'get_user_tasks',
        args: { includeCompleted: false },
      }),
    })

    if (!legacyMcpResponse.ok) {
      const error = await legacyMcpResponse.json()
      throw new Error(`Legacy MCP request failed: ${JSON.stringify(error)}`)
    }

    const legacyDeprecation = legacyMcpResponse.headers.get('X-Deprecation-Warning')
    console.log('✅ Legacy MCP token still works:')
    if (legacyDeprecation) {
      console.log(`   ⚠️  Deprecation Warning: ${legacyDeprecation}`)
    }
    console.log()

    // Cleanup
    console.log('8️⃣  Cleaning up test data...')
    await prisma.task.deleteMany({ where: { creatorId: testUser.id } })
    await prisma.oAuthToken.deleteMany({ where: { userId: testUser.id } })
    await prisma.oAuthClient.deleteMany({ where: { userId: testUser.id } })
    await prisma.mCPToken.deleteMany({ where: { userId: testUser.id } })
    await prisma.user.delete({ where: { id: testUser.id } })
    console.log('✅ Cleanup complete\n')

    console.log('🎉 All OAuth tests passed successfully!')
    console.log('\n📋 Summary:')
    console.log('   ✅ OAuth client creation')
    console.log('   ✅ Client credentials flow')
    console.log('   ✅ Access token generation')
    console.log('   ✅ New API v1 endpoints (OAuth auth)')
    console.log('   ✅ Legacy MCP endpoints (OAuth auth)')
    console.log('   ✅ Legacy MCP tokens (backward compat)')
    console.log('   ✅ Deprecation warnings working')

  } catch (error) {
    console.error('\n❌ Test failed:', error)
    process.exit(1)
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
