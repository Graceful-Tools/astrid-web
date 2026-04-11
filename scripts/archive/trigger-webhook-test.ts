#!/usr/bin/env npx tsx
/**
 * Manually trigger a webhook to test the Claude Code Remote flow
 */

import dotenv from 'dotenv'
import path from 'path'
import { generateWebhookHeaders } from '../lib/webhook-signature'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const webhookUrl = process.env.CLAUDE_REMOTE_WEBHOOK_URL
const webhookSecret = process.env.CLAUDE_REMOTE_WEBHOOK_SECRET

if (!webhookUrl || !webhookSecret) {
  console.error('Missing CLAUDE_REMOTE_WEBHOOK_URL or CLAUDE_REMOTE_WEBHOOK_SECRET')
  process.exit(1)
}

console.log('🔔 Triggering manual webhook...')
console.log('📤 URL:', webhookUrl)

const payload = {
  event: 'task.assigned' as const,
  timestamp: new Date().toISOString(),
  aiAgent: {
    id: 'claude-agent',
    name: 'Claude Agent',
    type: 'claude_agent',
    email: 'claude@astrid.cc'
  },
  task: {
    id: 'manual-test-' + Date.now(),
    title: 'Manual webhook test from CLI',
    description: 'Just say hello to confirm webhook is working',
    priority: 2,
    assigneeId: 'claude-agent',
    creatorId: 'user-id',
    listId: 'list-id',
    url: 'https://astrid.cc/tasks/test'
  },
  list: {
    id: 'list-id',
    name: 'Test List',
    githubRepositoryId: 'Graceful-Tools/astrid-res-www'
  },
  mcp: {
    baseUrl: 'https://astrid.cc',
    operationsEndpoint: '/api/mcp/operations',
    availableOperations: ['task.read', 'task.update'],
    contextInstructions: 'Test webhook - just say hello'
  },
  creator: {
    id: 'user-id',
    name: 'Test User',
    email: 'test@example.com'
  },
  comments: []
}

const body = JSON.stringify(payload)
const headers = generateWebhookHeaders(body, webhookSecret, 'task.assigned')

async function main() {
  try {
    const response = await fetch(webhookUrl!, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(10000)
    })

    console.log('📥 Response:', response.status, response.statusText)
    const data = await response.json()
    console.log(JSON.stringify(data, null, 2))

    if (response.ok) {
      console.log('✅ Webhook sent successfully!')
    }
  } catch (err) {
    console.error('❌ Error:', err)
  }
}

main()
