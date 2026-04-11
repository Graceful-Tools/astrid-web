/**
 * Restart Stuck AI Agent Tasks
 *
 * Finds tasks assigned to AI agents that appear stuck and re-triggers webhooks.
 * Run with: npx tsx scripts/restart-stuck-tasks.ts
 *
 * Options:
 *   --dry-run    Show what would be restarted without actually doing it
 *   --task-id    Restart a specific task by ID
 *   --list-id    Only restart tasks in a specific list
 */

import { prisma } from '../lib/prisma'
import { AIAgentWebhookService } from '../lib/ai-agent-webhook-service'

const DRY_RUN = process.argv.includes('--dry-run')
const SPECIFIC_TASK_ID = process.argv.find(arg => arg.startsWith('--task-id='))?.split('=')[1]
const SPECIFIC_LIST_ID = process.argv.find(arg => arg.startsWith('--list-id='))?.split('=')[1]
  || process.env.ASTRID_OAUTH_LIST_ID // Default to the configured list

async function main() {
  console.log('🔍 Finding stuck AI agent tasks...\n')

  // Find all AI agents
  const aiAgents = await prisma.user.findMany({
    where: { isAIAgent: true },
    select: { id: true, email: true, name: true }
  })

  console.log(`Found ${aiAgents.length} AI agents:`)
  aiAgents.forEach(a => console.log(`  - ${a.name} (${a.email})`))

  if (SPECIFIC_LIST_ID) {
    const list = await prisma.taskList.findUnique({
      where: { id: SPECIFIC_LIST_ID },
      select: { name: true }
    })
    console.log(`\n📋 Filtering to list: ${list?.name || SPECIFIC_LIST_ID}`)
  }
  console.log('')

  // Find uncompleted tasks assigned to AI agents
  const tasks = await prisma.task.findMany({
    where: {
      assigneeId: { in: aiAgents.map(a => a.id) },
      completed: false,
      ...(SPECIFIC_TASK_ID ? { id: SPECIFIC_TASK_ID } : {}),
      ...(SPECIFIC_LIST_ID ? { lists: { some: { id: SPECIFIC_LIST_ID } } } : {})
    },
    include: {
      assignee: { select: { id: true, name: true, email: true } },
      lists: {
        select: {
          id: true,
          name: true,
          ownerId: true,
          owner: { select: { email: true } }
        }
      },
      comments: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { createdAt: true, content: true }
      }
    }
  })

  if (tasks.length === 0) {
    console.log('✅ No stuck tasks found!')
    return
  }

  console.log(`Found ${tasks.length} uncompleted AI agent tasks:\n`)

  const webhookService = new AIAgentWebhookService()
  let restartedCount = 0

  for (const task of tasks) {
    const lastComment = task.comments[0]
    const lastActivityAge = lastComment
      ? Math.round((Date.now() - lastComment.createdAt.getTime()) / 1000 / 60)
      : null

    console.log(`📋 ${task.title?.slice(0, 60)}...`)
    console.log(`   ID: ${task.id}`)
    console.log(`   Assigned to: ${task.assignee?.name}`)
    console.log(`   List: ${task.lists?.[0]?.name || 'Unknown'}`)
    console.log(`   List owner: ${task.lists?.[0]?.owner?.email || 'Unknown'}`)
    console.log(`   Last activity: ${lastActivityAge !== null ? `${lastActivityAge} minutes ago` : 'No comments'}`)

    if (lastComment?.content?.includes('Claude Agent starting')) {
      console.log(`   ⚠️  Appears STUCK (last comment was "starting" message)`)
    }

    if (DRY_RUN) {
      console.log(`   🔄 Would restart (dry run)\n`)
    } else {
      console.log(`   🔄 Restarting...`)

      try {
        // Trigger the webhook as if the task was just assigned
        await webhookService.notifyTaskAssignment(task.id, task.assignee!.id, 'task.assigned')
        console.log(`   ✅ Webhook triggered!\n`)
        restartedCount++
      } catch (error) {
        console.log(`   ❌ Failed: ${error instanceof Error ? error.message : error}\n`)
      }
    }
  }

  if (DRY_RUN) {
    console.log(`\n🔍 Dry run complete. ${tasks.length} tasks would be restarted.`)
    console.log(`Run without --dry-run to actually restart them.`)
  } else {
    console.log(`\n✅ Restarted ${restartedCount}/${tasks.length} tasks.`)
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
