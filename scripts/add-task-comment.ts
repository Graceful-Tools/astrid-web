#!/usr/bin/env npx tsx

/**
 * Add a comment to a task on astrid.cc via OAuth API
 * Usage: npx tsx scripts/add-task-comment.ts <taskId> "<comment content>"
 *
 * Comments are posted as the Claude Agent (claude@astrid.cc) so they appear
 * from the AI agent, not from the OAuth client owner.
 */

import { loadScriptEnv } from './lib/load-env'
// Env var, then a lookup by the agent's identity address, then null — the same
// rule the sweep and the chat poster use (AWTD-970). This script grew that logic
// first; it is shared now so there is one answer to "who is writing this".
import { resolveAgentAuthorId } from './lib/agent-author'

loadScriptEnv()

async function addTaskComment() {
  const args = process.argv.slice(2)

  if (args.length < 2) {
    console.error('Usage: npx tsx scripts/add-task-comment.ts <taskId> "<comment content>"')
    console.error('Example: npx tsx scripts/add-task-comment.ts "ab6fdbdc-ddd6-4e6b-ab7c-c1f5c1dd5c0a" "Fix completed successfully"')
    process.exit(1)
  }

  const [taskId, commentContent] = args

  console.log(`📝 Adding comment to task ${taskId}...`)

  const clientId = process.env.ASTRID_OAUTH_CLIENT_ID
  const clientSecret = process.env.ASTRID_OAUTH_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    console.error('❌ OAuth credentials not found in .env.local')
    console.error('   Required: ASTRID_OAUTH_CLIENT_ID and ASTRID_OAUTH_CLIENT_SECRET')
    process.exit(1)
  }

  try {
    // Step 1: Obtain OAuth access token
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
      process.exit(1)
    }

    const { access_token } = await tokenResponse.json()

    // Step 2: Get the Claude agent ID so comments appear from the AI agent
    const aiAgentId = await resolveAgentAuthorId({ mailbox: 'claude', accessToken: access_token })

    // Step 3: Add comment using OAuth token, posting as Claude agent
    const body: { content: string; type: string; aiAgentId?: string } = {
      content: commentContent,
      type: 'TEXT'
    }

    if (aiAgentId) {
      body.aiAgentId = aiAgentId
      console.log(`🤖 Posting comment as Claude Agent`)
    } else {
      console.warn('⚠️ Comment will be posted as OAuth user (Claude agent ID not found)')
    }

    const response = await fetch(`https://astrid.cc/api/v1/tasks/${taskId}/comments`, {
      method: 'POST',
      headers: {
        'X-OAuth-Token': access_token,  // Use X-OAuth-Token header (works in production)
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })

    if (response.ok) {
      const result = await response.json()
      console.log('✅ Comment added successfully!')
      console.log(`📄 Comment ID: ${result?.comment?.id || result?.id || 'N/A'}`)
      if (aiAgentId) {
        console.log(`👤 Author: Claude Agent (${aiAgentId})`)
      }
    } else {
      const error = await response.text()
      console.error('❌ Failed to add comment:', error)
      process.exit(1)
    }
  } catch (error) {
    console.error('❌ Error adding comment:', error)
    process.exit(1)
  }
}

addTaskComment()