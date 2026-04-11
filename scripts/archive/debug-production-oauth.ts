#!/usr/bin/env npx tsx
/**
 * Debug Production OAuth Flow
 *
 * Tests each step of the OAuth flow against production astrid.cc
 * to identify where the token validation is failing.
 */

import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const PROD_API = 'https://astrid.cc'

async function debugProductionOAuth() {
  console.log('🔍 Debugging Production OAuth Flow\n')

  const clientId = process.env.ASTRID_OAUTH_CLIENT_ID
  const clientSecret = process.env.ASTRID_OAUTH_CLIENT_SECRET
  const listId = process.env.ASTRID_OAUTH_LIST_ID

  if (!clientId || !clientSecret) {
    console.error('❌ Missing OAuth credentials in .env.local')
    return
  }

  console.log('📋 Configuration:')
  console.log('   Client ID:', clientId)
  console.log('   Client Secret:', clientSecret.substring(0, 20) + '...')
  console.log('   List ID:', listId)
  console.log('   API Base:', PROD_API)
  console.log()

  // Step 1: Test token generation
  console.log('Step 1: Testing token generation...')
  const tokenResponse = await fetch(`${PROD_API}/api/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret
    })
  })

  console.log('   Status:', tokenResponse.status)

  if (!tokenResponse.ok) {
    const error = await tokenResponse.json()
    console.error('   ❌ Token generation failed:', error)
    return
  }

  const tokenData = await tokenResponse.json()
  console.log('   ✅ Token generated successfully')
  console.log('   Token prefix:', tokenData.access_token.substring(0, 30) + '...')
  console.log('   Token length:', tokenData.access_token.length)
  console.log('   Token type:', tokenData.token_type)
  console.log('   Expires in:', tokenData.expires_in, 'seconds')
  console.log('   Scopes:', tokenData.scope)
  console.log()

  const accessToken = tokenData.access_token

  // Step 2: Test token validation with /api/v1/lists (simpler endpoint)
  console.log('Step 2: Testing token with /api/v1/lists endpoint...')
  const listsResponse = await fetch(`${PROD_API}/api/v1/lists`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  })

  console.log('   Status:', listsResponse.status)
  const listsData = await listsResponse.json()

  if (!listsResponse.ok) {
    console.log('   ❌ Lists endpoint failed:', listsData)
  } else {
    console.log('   ✅ Lists endpoint succeeded')
    console.log('   Lists returned:', listsData.lists?.length || 0)
    if (listsData.meta) {
      console.log('   Auth source:', listsData.meta.authSource)
    }
  }
  console.log()

  // Step 3: Test with tasks endpoint
  console.log('Step 3: Testing token with /api/v1/tasks endpoint...')
  const tasksUrl = listId
    ? `${PROD_API}/api/v1/tasks?listId=${listId}&completed=false`
    : `${PROD_API}/api/v1/tasks?completed=false&limit=5`

  const tasksResponse = await fetch(tasksUrl, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  })

  console.log('   Status:', tasksResponse.status)
  const tasksData = await tasksResponse.json()

  if (!tasksResponse.ok) {
    console.log('   ❌ Tasks endpoint failed:', tasksData)
  } else {
    console.log('   ✅ Tasks endpoint succeeded')
    console.log('   Tasks returned:', tasksData.tasks?.length || 0)
    if (tasksData.meta) {
      console.log('   Auth source:', tasksData.meta.authSource)
    }
  }
  console.log()

  // Step 4: Check response headers for debugging info
  console.log('Step 4: Checking response headers...')
  console.log('   X-Deprecation-Warning:', tasksResponse.headers.get('X-Deprecation-Warning') || 'None')
  console.log('   X-Vercel-Cache:', tasksResponse.headers.get('X-Vercel-Cache') || 'None')
  console.log('   X-Vercel-Id:', tasksResponse.headers.get('X-Vercel-Id') || 'None')
  console.log()

  // Step 5: Try different header formats
  console.log('Step 5: Testing alternative token header format...')
  const altResponse = await fetch(`${PROD_API}/api/v1/lists`, {
    method: 'GET',
    headers: {
      'X-OAuth-Token': accessToken,
      'Content-Type': 'application/json'
    }
  })

  console.log('   Status with X-OAuth-Token header:', altResponse.status)
  if (!altResponse.ok) {
    const altData = await altResponse.json()
    console.log('   Response:', altData)
  } else {
    console.log('   ✅ Alternative header worked!')
  }
  console.log()

  // Summary
  console.log('═'.repeat(60))
  console.log('SUMMARY')
  console.log('═'.repeat(60))
  console.log('Token Generation:', tokenResponse.ok ? '✅ Working' : '❌ Failed')
  console.log('Lists Endpoint:', listsResponse.ok ? '✅ Working' : '❌ Failed')
  console.log('Tasks Endpoint:', tasksResponse.ok ? '✅ Working' : '❌ Failed')
  console.log()

  if (!listsResponse.ok || !tasksResponse.ok) {
    console.log('🔍 Diagnosis:')
    console.log('Token is generated successfully but validation fails.')
    console.log('This suggests one of:')
    console.log('1. Token not being saved to production database')
    console.log('2. Production code still using old findUnique query')
    console.log('3. Database connection issue in serverless functions')
    console.log('4. OAuth client not properly configured in production DB')
  } else {
    console.log('✅ OAuth workflow is working correctly!')
  }
}

debugProductionOAuth().catch(console.error)
