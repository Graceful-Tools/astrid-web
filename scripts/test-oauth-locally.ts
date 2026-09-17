#!/usr/bin/env npx tsx
/**
 * Test OAuth flow locally
 * Creates a test client, generates token, validates it
 */

import { prisma } from '@/lib/prisma'
import { SCOPE_GROUPS } from '../lib/oauth/oauth-scopes'
import { hashClientSecret } from '@/lib/oauth/oauth-token-manager'

async function testOAuthLocally() {
  console.log('🧪 Testing OAuth flow locally...\n')

  try {
    // Step 1: Create test user
    console.log('1. Creating test user...')
    const testUser = await prisma.user.upsert({
      where: { email: 'oauth-test@example.com' },
      update: {},
      create: {
        email: 'oauth-test@example.com',
        name: 'OAuth Test User',
        isAIAgent: true,
      },
    })
    console.log('   ✅ Test user created:', testUser.id)

    // Step 2: Create test OAuth client
    console.log('\n2. Creating test OAuth client...')
    const clientSecret = 'test_secret_' + Math.random().toString(36)
    const testClient = await prisma.oAuthClient.upsert({
      where: { clientId: 'test_client_local' },
      update: {
        clientSecret: hashClientSecret(clientSecret),
      },
      create: {
        clientId: 'test_client_local',
        clientSecret: hashClientSecret(clientSecret),
        name: 'Local Test Client',
        description: 'For testing OAuth flow locally',
        userId: testUser.id,
        redirectUris: [],
        grantTypes: ['client_credentials'],
        // From the group rather than another copy (task 9ebfaba7).
        scopes: [...SCOPE_GROUPS.tasks_only],
        isActive: true,
      },
    })
    console.log('   ✅ Test client created:', testClient.id)
    console.log('   Client ID:', testClient.clientId)
    console.log('   Client Secret:', clientSecret)

    // Step 3: Test token generation via API
    console.log('\n3. Testing token generation via API...')
    const tokenResponse = await fetch('http://localhost:3001/api/v1/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: testClient.clientId,
        client_secret: clientSecret,
      }),
    })

    if (!tokenResponse.ok) {
      const error = await tokenResponse.json()
      console.log('   ❌ Token generation failed:', error)
      return
    }

    const tokenData = await tokenResponse.json()
    console.log('   ✅ Token generated')
    console.log('   Token prefix:', tokenData.access_token.substring(0, 20) + '...')
    console.log('   Expires in:', tokenData.expires_in, 'seconds')

    // Step 4: Test token validation via API
    console.log('\n4. Testing token validation via API...')
    const tasksResponse = await fetch('http://localhost:3001/api/v1/tasks?limit=5', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json',
      },
    })

    console.log('   Status:', tasksResponse.status)
    const tasksData = await tasksResponse.json()

    if (tasksResponse.ok) {
      console.log('   ✅ Token validated successfully!')
      console.log('   Auth source:', tasksData.meta?.authSource)
      console.log('   Tasks returned:', tasksData.tasks?.length || 0)
      console.log('\n✅ OAuth flow working correctly!')
    } else {
      console.log('   ❌ Token validation failed:', tasksData)
      console.log('\n❌ OAuth flow has issues')
    }

    // Cleanup
    console.log('\n5. Cleaning up test data...')
    await prisma.oAuthToken.deleteMany({
      where: { clientId: testClient.id },
    })
    await prisma.oAuthClient.delete({
      where: { id: testClient.id },
    })
    await prisma.user.delete({
      where: { id: testUser.id },
    })
    console.log('   ✅ Cleanup complete')

  } catch (error) {
    console.error('\n❌ Error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

testOAuthLocally()
