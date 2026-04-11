#!/usr/bin/env npx tsx

/**
 * Add a comment to a task on astrid.cc via OAuth API
 * Usage: npx tsx scripts/add-oauth-comment.ts <taskId> "<comment content>"
 */

import dotenv from 'dotenv'
import path from 'path'

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function getOAuthToken(): Promise<string> {
  const clientId = process.env.ASTRID_OAUTH_CLIENT_ID
  const clientSecret = process.env.ASTRID_OAUTH_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error('Missing ASTRID_OAUTH_CLIENT_ID or ASTRID_OAUTH_CLIENT_SECRET')
  }

  const response = await fetch('https://astrid.cc/api/v1/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  })

  if (!response.ok) {
    throw new Error(`Failed to get OAuth token: ${response.statusText}`)
  }

  const data = await response.json()
  return data.access_token
}

async function addTaskComment() {
  const args = process.argv.slice(2)

  if (args.length < 2) {
    console.error('Usage: npx tsx scripts/add-oauth-comment.ts <taskId> "<comment content>"')
    console.error('Example: npx tsx scripts/add-oauth-comment.ts "ab6fdbdc-ddd6-4e6b-ab7c-c1f5c1dd5c0a" "Fix completed successfully"')
    process.exit(1)
  }

  const [taskId, commentContent] = args

  console.log(`📝 Adding comment to task ${taskId}...`)

  try {
    // Get OAuth access token
    console.log('🔐 Obtaining OAuth access token...')
    const accessToken = await getOAuthToken()
    console.log('✅ Access token obtained')

    // Add comment
    const response = await fetch(`https://astrid.cc/api/v1/tasks/${taskId}/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-OAuth-Token': accessToken,
      },
      body: JSON.stringify({
        content: commentContent,
        type: 'TEXT',
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to add comment: ${response.status} ${errorText}`)
    }

    const comment = await response.json()
    console.log('✅ Comment added successfully!')
    console.log(`   Comment ID: ${comment.comment.id}`)
    console.log(`   Content: ${comment.comment.content.substring(0, 100)}...`)
  } catch (error) {
    console.error('❌ Failed to add comment:', error)
    process.exit(1)
  }
}

addTaskComment()
