#!/usr/bin/env npx tsx

/**
 * Quick AI Agent Test
 * Simple test to verify AI agent responds to task assignments
 */

import { createScriptPrisma } from './lib/script-prisma'
import { aiAgentWebhookService } from '@/lib/ai-agent-webhook-service'

const prisma = createScriptPrisma()

async function quickTest() {
  console.log('🚀 Quick AI Agent Response Test\n')

  try {
    // 1. Find AI agent
    const aiAgent = await prisma.user.findFirst({
      where: {
        isAIAgent: true,
        aiAgentType: 'claude_agent'
      }
    })

    if (!aiAgent) {
      console.error('❌ AI agent not found')
      return
    }

    console.log('🤖 AI Agent:', aiAgent.name)
    console.log('🔗 Webhook URL:', aiAgent.webhookUrl)

    // 2. Find or create a simple test task
    let task = await prisma.task.findFirst({
      where: {
        title: 'Quick Test Task',
        assigneeId: aiAgent.id
      }
    })

    if (!task) {
      // Create a minimal test task
      const testUser = await prisma.user.findFirst({
        where: { isAIAgent: false }
      })

      if (!testUser) {
        console.error('❌ No regular users found to create test task')
        return
      }

      const testList = await prisma.taskList.findFirst({
        where: { ownerId: testUser.id }
      })

      if (!testList) {
        console.error('❌ No lists found to create test task')
        return
      }

      task = await prisma.task.create({
        data: {
          title: 'Quick Test Task',
          description: 'Testing AI agent response',
          priority: 1,
          assigneeId: aiAgent.id,
          creatorId: testUser.id,
          lists: {
            connect: { id: testList.id }
          }
        }
      })

      console.log('📋 Created test task:', task.title)
    } else {
      console.log('📋 Using existing test task:', task.title)
    }

    // 3. Count current comments
    const beforeComments = await prisma.comment.count({
      where: {
        taskId: task.id,
        authorId: aiAgent.id
      }
    })

    console.log('💬 Comments before:', beforeComments)

    // 4. Trigger AI agent notification
    console.log('🚀 Triggering AI agent notification...')
    await aiAgentWebhookService.notifyTaskAssignment(task.id, aiAgent.id)

    // 5. Wait and check for response
    console.log('⏳ Waiting 3 seconds for response...')
    await new Promise(resolve => setTimeout(resolve, 3000))

    const afterComments = await prisma.comment.count({
      where: {
        taskId: task.id,
        authorId: aiAgent.id
      }
    })

    console.log('💬 Comments after:', afterComments)

    if (afterComments > beforeComments) {
      console.log('✅ SUCCESS: AI agent responded with comments!')

      const latestComment = await prisma.comment.findFirst({
        where: {
          taskId: task.id,
          authorId: aiAgent.id
        },
        orderBy: { createdAt: 'desc' }
      })

      if (latestComment) {
        console.log('\n📝 Latest AI agent comment:')
        console.log('---')
        console.log(latestComment.content.substring(0, 300))
        if (latestComment.content.length > 300) {
          console.log('...')
        }
        console.log('---')
      }

      console.log('\n🎉 AI Agent workflow is working!')
      console.log('💡 Try assigning a task in the web interface to see real-time responses')

    } else {
      console.log('❌ FAILED: AI agent did not respond')
      console.log('\n🔍 Debug Info:')
      console.log('  • Check webhook URL configuration')
      console.log('  • Check server logs for errors')
      console.log('  • Verify /api/ai-agent/webhook endpoint is working')
    }

  } catch (error) {
    console.error('❌ Test failed:', error)
  } finally {
    await prisma.$disconnect()
  }
}

quickTest().catch(console.error)