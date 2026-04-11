#!/usr/bin/env npx tsx

/**
 * Complete a task and add summary comment using OAuth
 * Usage: npx tsx scripts/complete-task-oauth.ts <taskId> "<summary>"
 */

import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function completeTask() {
  const args = process.argv.slice(2)

  if (args.length < 2) {
    console.error('Usage: npx tsx scripts/complete-task-oauth.ts <taskId> "<summary>"')
    process.exit(1)
  }

  const [taskId, summary] = args

  const clientId = process.env.ASTRID_OAUTH_CLIENT_ID
  const clientSecret = process.env.ASTRID_OAUTH_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    console.error('❌ OAuth credentials not found in .env.local')
    return
  }

  try {
    // Step 1: Get OAuth token
    console.log('🔐 Obtaining OAuth access token...')
    const tokenResponse = await fetch('https://astrid.cc/api/v1/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret
      })
    })

    if (!tokenResponse.ok) {
      const error = await tokenResponse.json()
      console.error('❌ Failed to obtain access token:', error)
      return
    }

    const { access_token } = await tokenResponse.json()
    console.log('✅ Access token obtained\n')

    // Step 2: Add completion comment
    console.log(`📝 Adding completion comment to task ${taskId}...`)
    const commentResponse = await fetch(`https://astrid.cc/api/v1/tasks/${taskId}/comments`, {
      method: 'POST',
      headers: {
        'X-OAuth-Token': access_token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content: summary,
        type: 'TEXT'
      })
    })

    if (!commentResponse.ok) {
      const error = await commentResponse.json()
      console.error('❌ Failed to add comment:', error)
      return
    }

    console.log('✅ Completion comment added\n')

    // Step 3: Mark task as complete
    console.log(`✅ Marking task ${taskId} as complete...`)
    const updateResponse = await fetch(`https://astrid.cc/api/v1/tasks/${taskId}`, {
      method: 'PUT',
      headers: {
        'X-OAuth-Token': access_token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        completed: true
      })
    })

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text()
      console.error('❌ Failed to complete task:', errorText)
      return
    }

    // Try to parse response, but handle empty/non-JSON responses
    try {
      const result = await updateResponse.json()
      console.log('✅ Task marked as complete!\n')
      console.log('🎉 Task completion workflow finished successfully!')
    } catch (e) {
      // Response might be empty or not JSON - that's okay if status was 200
      console.log('✅ Task marked as complete!\n')
      console.log('🎉 Task completion workflow finished successfully!')
    }
  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

completeTask()
