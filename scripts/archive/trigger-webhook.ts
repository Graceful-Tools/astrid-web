/**
 * Trigger Webhook for Stuck Tasks
 *
 * Directly sends webhooks to the Claude Code Remote server.
 * Run with: npx tsx scripts/trigger-webhook.ts [--dry-run]
 */

import { prisma } from '../lib/prisma'
import { generateWebhookHeaders } from '../lib/webhook-signature'
import { decryptField } from '../lib/field-encryption'

const DRY_RUN = process.argv.includes('--dry-run')
const LIST_ID = process.env.ASTRID_OAUTH_LIST_ID

async function main() {
  console.log('🔍 Finding stuck AI agent tasks...\n')

  // Get webhook config
  const webhookConfig = await prisma.userWebhookConfig.findFirst({
    where: { enabled: true },
    include: { user: { select: { id: true, email: true } } }
  })

  if (!webhookConfig) {
    console.log('❌ No webhook config found!')
    return
  }

  const webhookUrl = decryptField(webhookConfig.webhookUrl)!
  const webhookSecret = decryptField(webhookConfig.webhookSecret)!
  console.log(`📡 Webhook URL: ${webhookUrl}`)
  console.log(`👤 Webhook user: ${webhookConfig.user.email}\n`)

  // Find Claude agent
  const claudeAgent = await prisma.user.findFirst({
    where: { email: 'claude@astrid.cc' }
  })

  if (!claudeAgent) {
    console.log('❌ Claude agent not found!')
    return
  }

  // Find stuck tasks
  const tasks = await prisma.task.findMany({
    where: {
      assigneeId: claudeAgent.id,
      completed: false,
      ...(LIST_ID ? { lists: { some: { id: LIST_ID } } } : {})
    },
    include: {
      assignee: { select: { id: true, name: true, email: true } },
      lists: { select: { id: true, name: true, githubRepositoryId: true, ownerId: true } },
      creator: { select: { id: true, name: true, email: true } },
      comments: {
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { content: true, createdAt: true, author: { select: { name: true } } }
      }
    }
  })

  console.log(`Found ${tasks.length} tasks assigned to Claude Agent:\n`)

  for (const task of tasks) {
    const list = task.lists[0]
    console.log(`📋 ${task.title?.slice(0, 60)}`)
    console.log(`   ID: ${task.id}`)
    console.log(`   List: ${list?.name || 'Unknown'}`)

    // Build webhook payload
    const payload = {
      event: 'task.assigned',
      timestamp: new Date().toISOString(),
      aiAgent: {
        id: task.assignee!.id,
        name: task.assignee!.name || 'Claude Agent',
        type: 'claude_agent',
        email: task.assignee!.email
      },
      task: {
        id: task.id,
        title: task.title,
        description: task.description,
        priority: task.priority,
        assigneeId: task.assigneeId!,
        creatorId: task.creatorId,
        listId: list?.id || '',
        url: `https://astrid.cc/task/${task.id}`
      },
      list: list ? {
        id: list.id,
        name: list.name,
        githubRepositoryId: list.githubRepositoryId
      } : undefined,
      creator: task.creator ? {
        id: task.creator.id,
        name: task.creator.name,
        email: task.creator.email
      } : { id: null, email: 'unknown@astrid.cc' },
      comments: task.comments.map(c => ({
        content: c.content,
        authorName: c.author?.name || 'Unknown',
        createdAt: c.createdAt.toISOString()
      }))
    }

    if (DRY_RUN) {
      console.log(`   🔄 Would send webhook (dry run)\n`)
      continue
    }

    console.log(`   🔄 Sending webhook...`)

    try {
      const body = JSON.stringify(payload)
      const headers = generateWebhookHeaders(body, webhookSecret, 'task.assigned')

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(10000)
      })

      if (response.ok) {
        const result = await response.json()
        console.log(`   ✅ Webhook sent! Response:`, result)
      } else {
        console.log(`   ❌ HTTP ${response.status}: ${await response.text()}`)
      }
    } catch (error) {
      console.log(`   ❌ Error: ${error instanceof Error ? error.message : error}`)
    }
    console.log('')
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
