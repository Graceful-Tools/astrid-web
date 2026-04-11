#!/usr/bin/env npx tsx
/**
 * Restart AI Agent Tasks via Astrid API
 *
 * Triggers webhook by updating tasks assigned to AI agents.
 * Run with: npx tsx scripts/restart-ai-tasks.ts [--dry-run]
 */

import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const DRY_RUN = process.argv.includes('--dry-run')
const BASE_URL = process.env.ASTRID_API_URL || 'https://astrid.cc'
const LIST_ID = process.env.ASTRID_OAUTH_LIST_ID

interface OAuthToken {
  access_token: string
  token_type: string
}

async function getAccessToken(): Promise<string> {
  const clientId = process.env.ASTRID_OAUTH_CLIENT_ID
  const clientSecret = process.env.ASTRID_OAUTH_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error('Missing ASTRID_OAUTH_CLIENT_ID or ASTRID_OAUTH_CLIENT_SECRET')
  }

  const response = await fetch(`${BASE_URL}/api/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'tasks:read tasks:write'
    })
  })

  if (!response.ok) {
    throw new Error(`OAuth failed: ${response.status}`)
  }

  const data = await response.json() as OAuthToken
  return data.access_token
}

async function main() {
  console.log('🔐 Getting access token...')
  const token = await getAccessToken()
  console.log('✅ Got access token\n')

  // Get tasks from the list
  console.log(`📋 Fetching tasks from list ${LIST_ID}...`)
  const tasksResponse = await fetch(`${BASE_URL}/api/v1/tasks?listId=${LIST_ID}&completed=false`, {
    headers: { 'X-OAuth-Token': token }
  })

  if (!tasksResponse.ok) {
    throw new Error(`Failed to get tasks: ${tasksResponse.status}`)
  }

  const response = await tasksResponse.json()
  const tasks = response.tasks || response // Handle both {tasks: [...]} and [...] formats

  if (!Array.isArray(tasks)) {
    console.log('Response:', JSON.stringify(response, null, 2))
    throw new Error('Unexpected response format')
  }

  // Filter to AI agent assigned tasks that aren't completed
  const aiTasks = tasks.filter((t: any) =>
    !t.completed &&
    t.assignee?.isAIAgent === true
  )

  console.log(`Found ${aiTasks.length} uncompleted AI agent tasks:\n`)

  for (const task of aiTasks) {
    console.log(`📋 ${task.title?.slice(0, 60)}`)
    console.log(`   ID: ${task.id}`)
    console.log(`   Assigned to: ${task.assignee?.name}`)

    if (DRY_RUN) {
      console.log(`   🔄 Would restart (dry run)\n`)
      continue
    }

    // Trigger the webhook by unassigning and then reassigning
    // This forces the Prisma middleware to detect a "new" assignment
    console.log(`   🔄 Triggering webhook (unassign → reassign)...`)

    try {
      // Step 1: Unassign
      const unassignRes = await fetch(`${BASE_URL}/api/v1/tasks/${task.id}`, {
        method: 'PUT',
        headers: { 'X-OAuth-Token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ assigneeId: null })
      })

      if (!unassignRes.ok) {
        console.log(`   ❌ Unassign failed: HTTP ${unassignRes.status}`)
        continue
      }

      // Small delay to ensure the update is processed
      await new Promise(r => setTimeout(r, 500))

      // Step 2: Reassign to the AI agent
      const reassignRes = await fetch(`${BASE_URL}/api/v1/tasks/${task.id}`, {
        method: 'PUT',
        headers: { 'X-OAuth-Token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ assigneeId: task.assignee?.id })
      })

      if (reassignRes.ok) {
        console.log(`   ✅ Webhook triggered!`)
      } else {
        const error = await reassignRes.text()
        console.log(`   ❌ Reassign failed: HTTP ${reassignRes.status}: ${error}`)
      }
    } catch (error) {
      console.log(`   ❌ Error: ${error instanceof Error ? error.message : error}`)
    }
    console.log('')
  }

  if (DRY_RUN) {
    console.log(`\n🔍 Dry run complete. Run without --dry-run to restart tasks.`)
  } else {
    console.log(`\n✅ Done! Check Fly.io logs to verify webhooks were received.`)
  }
}

main().catch(console.error)
