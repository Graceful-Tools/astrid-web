#!/usr/bin/env npx tsx

/**
 * Add a comment to a task on astrid.cc via OAuth API
 * Usage: npx tsx scripts/add-task-comment.ts <taskId> "<comment content>"
 *
 * Comments are posted as the Claude Agent (claude@astrid.cc) so they appear
 * from the AI agent, not from the OAuth client owner.
 */

import { loadScriptEnv } from './lib/load-env'

loadScriptEnv()

/**
 * Get the Claude agent user ID from env or by looking up assigned tasks
 */
async function getClaudeAgentId(accessToken: string): Promise<string | null> {
  // Prefer env var — avoids API lookup entirely
  if (process.env.CLAUDE_AGENT_ID) {
    return process.env.CLAUDE_AGENT_ID
  }

  const agentEmail = process.env.CLAUDE_AGENT_EMAIL || 'claude@astrid.cc'

  try {
    // Fallback: find a task assigned to the Claude agent to get the agent's user ID
    const response = await fetch(
      `https://astrid.cc/api/v1/tasks?assigneeEmail=${encodeURIComponent(agentEmail)}&limit=1`,
      {
        headers: {
          'X-OAuth-Token': accessToken,
          'Content-Type': 'application/json'
        }
      }
    )

    if (response.ok) {
      const data = await response.json()
      const tasks = data.tasks || [data.task].filter(Boolean)

      if (tasks.length > 0 && tasks[0].assignee?.id) {
        return tasks[0].assignee.id
      }
    }

    console.warn(`⚠️ Could not find Claude agent ID for ${agentEmail}`)
    console.warn(`   Set CLAUDE_AGENT_ID in .env.local to fix this`)
    return null
  } catch (error) {
    console.warn(`⚠️ Error looking up Claude agent:`, error)
    return null
  }
}

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
    const aiAgentId = await getClaudeAgentId(access_token)

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