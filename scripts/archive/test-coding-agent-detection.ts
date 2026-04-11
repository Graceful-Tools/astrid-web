/**
 * Test Coding Agent Detection
 * Check if the coding agent detection logic works correctly
 */

import { PrismaClient } from '@prisma/client'

// Helper function to check if a user is a coding agent
function isCodingAgent(user: any): boolean {
  return user.isAIAgent === true && user.aiAgentType === 'coding_agent'
}

async function testCodingAgentDetection() {
  const prisma = new PrismaClient()

  try {
    console.log('🔍 Testing Coding Agent Detection\n')

    // Get the coding agent from database
    const codingAgent = await prisma.user.findFirst({
      where: {
        isAIAgent: true,
        aiAgentType: 'coding_agent'
      }
    })

    if (!codingAgent) {
      console.log('❌ Coding agent not found in database')
      return
    }

    console.log('🤖 Raw Coding Agent from Database:')
    console.log('   ID:', codingAgent.id)
    console.log('   Name:', codingAgent.name)
    console.log('   Email:', codingAgent.email)
    console.log('   isAIAgent:', codingAgent.isAIAgent)
    console.log('   aiAgentType:', codingAgent.aiAgentType)
    console.log('   aiAgentConfig:', codingAgent.aiAgentConfig)

    // Test the detection function
    const isDetectedAsCodingAgent = isCodingAgent(codingAgent)
    console.log('\n🔍 Detection Test:')
    console.log('   isCodingAgent(codingAgent):', isDetectedAsCodingAgent)

    if (!isDetectedAsCodingAgent) {
      console.log('❌ PROBLEM: Coding agent not detected by isCodingAgent function!')
      console.log('   Expected: isAIAgent === true && aiAgentType === "coding_agent"')
      console.log('   Actual: isAIAgent =', codingAgent.isAIAgent, ', aiAgentType =', codingAgent.aiAgentType)
    } else {
      console.log('✅ Coding agent detected successfully!')
    }

    // Test with a recent task to see what the assignee object looks like
    const taskWithAssignee = await prisma.task.findFirst({
      where: {
        assigneeId: codingAgent.id
      },
      include: {
        assignee: true
      }
    })

    if (taskWithAssignee?.assignee) {
      console.log('\n📋 Task Assignee Object:')
      console.log('   ID:', taskWithAssignee.assignee.id)
      console.log('   Name:', taskWithAssignee.assignee.name)
      console.log('   isAIAgent:', taskWithAssignee.assignee.isAIAgent)
      console.log('   aiAgentType:', taskWithAssignee.assignee.aiAgentType)

      const taskAssigneeDetected = isCodingAgent(taskWithAssignee.assignee)
      console.log('   isCodingAgent(task.assignee):', taskAssigneeDetected)
    }

  } catch (error) {
    console.error('❌ Error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

testCodingAgentDetection().catch(console.error)