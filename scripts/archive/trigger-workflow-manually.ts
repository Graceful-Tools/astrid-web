/**
 * Manually Trigger Coding Workflow
 * Test the AI workflow for the existing task
 */

import { PrismaClient } from '@prisma/client'

async function triggerWorkflowManually() {
  const prisma = new PrismaClient()

  try {
    console.log('🚀 Manually Triggering Coding Workflow\n')

    // Find the latest task assigned to coding agent
    const task = await prisma.task.findFirst({
      where: {
        assignee: {
          isAIAgent: true,
          aiAgentType: 'coding_agent'
        }
      },
      include: {
        assignee: true,
        creator: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    })

    if (!task) {
      console.log('❌ No tasks found assigned to coding agent')
      return
    }

    console.log('📋 Found Task:')
    console.log('   Title:', task.title)
    console.log('   ID:', task.id)
    console.log('   Description:', task.description)
    console.log('   Creator:', task.creator?.name, `(${task.creator?.email})`)
    console.log('   Assignee:', task.assignee?.name)

    // Check if workflow already exists
    const existingWorkflow = await prisma.codingTaskWorkflow.findUnique({
      where: { taskId: task.id }
    })

    if (existingWorkflow) {
      console.log('⚠️ Workflow already exists:', existingWorkflow.id)
      console.log('   Status:', existingWorkflow.status)
      return
    }

    // Create coding workflow
    console.log('\n🔧 Creating coding workflow...')
    const workflow = await prisma.codingTaskWorkflow.create({
      data: {
        taskId: task.id,
        status: 'PLANNING',
        planApproved: false,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    })

    console.log('✅ Workflow created:', workflow.id)

    // Test the AI orchestration API call
    console.log('\n🧠 Testing AI orchestration API...')

    try {
      const response = await fetch('http://localhost:3000/api/coding-workflow/start-ai-orchestration', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          workflowId: workflow.id,
          taskId: task.id,
          userId: task.creator?.id
        })
      })

      if (response.ok) {
        const result = await response.json()
        console.log('✅ AI orchestration started:', result)
      } else {
        const error = await response.text()
        console.log('❌ AI orchestration failed:', response.status, error)
      }
    } catch (fetchError) {
      console.log('❌ Network error calling AI orchestration:', fetchError)
    }

  } catch (error) {
    console.error('❌ Error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

triggerWorkflowManually().catch(console.error)