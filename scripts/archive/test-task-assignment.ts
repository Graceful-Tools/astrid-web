/**
 * Test Task Assignment Detection
 * Check if we can detect when a task is assigned to the coding agent
 */

import { PrismaClient } from '@prisma/client'

async function testTaskAssignment() {
  const prisma = new PrismaClient()

  try {
    console.log('🔍 Testing Task Assignment Detection\n')

    // Find the coding agent
    const codingAgent = await prisma.user.findFirst({
      where: {
        isAIAgent: true,
        aiAgentType: 'coding_agent'
      }
    })

    if (!codingAgent) {
      console.log('❌ Coding agent not found')
      return
    }

    console.log('🤖 Coding Agent Found:')
    console.log('   ID:', codingAgent.id)
    console.log('   Email:', codingAgent.email)
    console.log('   Name:', codingAgent.name)

    // Find recent tasks assigned to the coding agent
    const tasks = await prisma.task.findMany({
      where: {
        assigneeId: codingAgent.id
      },
      include: {
        creator: {
          select: { id: true, name: true, email: true }
        },
        assignee: {
          select: { id: true, name: true, email: true }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 5
    })

    console.log(`\n📋 Found ${tasks.length} tasks assigned to coding agent:`)

    for (const task of tasks) {
      console.log(`\n📝 Task: ${task.title}`)
      console.log(`   ID: ${task.id}`)
      console.log(`   Created: ${task.createdAt.toISOString()}`)
      console.log(`   Creator: ${task.creator?.name || 'Unknown'} (${task.creator?.email})`)
      console.log(`   Description: ${task.description?.substring(0, 100) || 'No description'}...`)

      // Check if there's a coding workflow for this task
      const workflow = await prisma.codingTaskWorkflow.findUnique({
        where: { taskId: task.id }
      })

      if (workflow) {
        console.log(`   ✅ Workflow exists: ${workflow.status}`)
        console.log(`   📊 Plan approved: ${workflow.planApproved}`)
        console.log(`   🔄 Created: ${workflow.createdAt.toISOString()}`)
      } else {
        console.log(`   ❌ No workflow found`)
      }
    }

    // Check coding workflows in general
    console.log('\n🔍 All Coding Workflows:')
    const allWorkflows = await prisma.codingTaskWorkflow.findMany({
      include: {
        task: {
          select: { id: true, title: true, createdAt: true }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 10
    })

    if (allWorkflows.length === 0) {
      console.log('❌ No coding workflows found in database')
    } else {
      for (const workflow of allWorkflows) {
        console.log(`\n🔄 Workflow ID: ${workflow.id}`)
        console.log(`   Task: ${workflow.task.title}`)
        console.log(`   Status: ${workflow.status}`)
        console.log(`   Created: ${workflow.createdAt.toISOString()}`)
      }
    }

  } catch (error) {
    console.error('❌ Error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

testTaskAssignment().catch(console.error)