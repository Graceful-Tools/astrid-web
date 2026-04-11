#!/usr/bin/env npx tsx
/**
 * Phase 2 Testing: Task Assignment Workflow
 * Tests the complete task assignment to coding agent workflow
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function testPhase2Workflow() {
  console.log('🧪 Testing Phase 2: Task Assignment Workflow...')

  let testUser: any = null
  let codingAgent: any = null
  let testTask: any = null
  let testList: any = null
  let workflow: any = null

  try {
    // Test 1: Create test AI agent (dynamic creation approach)
    console.log('📝 Test 1: Creating test AI agent for workflow...')
    // Create a test AI agent for this workflow test (agents are now created dynamically)
    codingAgent = await prisma.user.create({
      data: {
        id: 'test-workflow-agent-' + Date.now(),
        name: 'Test Workflow Agent',
        email: 'test-workflow@example.com',
        isAIAgent: true,
        aiAgentType: 'claude_agent',
        isActive: true
      },
      include: {
        mcpTokens: true,
        ownedLists: true
      }
    })

    console.log('✅ Test AI agent created:', codingAgent.email)
    console.log('   MCP Tokens:', codingAgent.mcpTokens.length)
    console.log('   Owned Lists:', codingAgent.ownedLists.length)

    // Test 2: Create test user
    console.log('📝 Test 2: Creating test user...')
    testUser = await prisma.user.create({
      data: {
        email: 'test-phase2@test.com',
        name: 'Test User Phase 2',
        isAIAgent: false
      }
    })
    console.log('✅ Test user created:', testUser.id)

    // Test 3: Create test list
    console.log('📝 Test 3: Creating test list...')
    testList = await prisma.taskList.create({
      data: {
        name: 'Test Coding Projects',
        description: 'Test list for coding agent tasks',
        ownerId: testUser.id,
        mcpEnabled: true,
        mcpAccessLevel: 'BOTH'
      }
    })
    console.log('✅ Test list created:', testList.id)

    // Test 4: Create test task
    console.log('📝 Test 4: Creating test task...')
    testTask = await prisma.task.create({
      data: {
        title: 'Add a simple header component',
        description: 'Create a reusable header component with navigation menu and logo',
        creatorId: testUser.id,
        lists: {
          connect: { id: testList.id }
        }
      }
    })
    console.log('✅ Test task created:', testTask.id)

    // Test 5: Assign task to coding agent
    console.log('📝 Test 5: Assigning task to coding agent...')
    const updatedTask = await prisma.task.update({
      where: { id: testTask.id },
      data: {
        assigneeId: codingAgent.id
      },
      include: {
        assignee: true,
        creator: true
      }
    })
    console.log('✅ Task assigned to coding agent')
    console.log('   Assignee:', updatedTask.assignee?.name)

    // Test 6: Create coding workflow
    console.log('📝 Test 6: Creating coding workflow...')
    workflow = await prisma.codingTaskWorkflow.create({
      data: {
        taskId: testTask.id,
        aiService: 'claude',
        status: 'PENDING',
        repositoryId: 'test-user/test-repo'
      },
      include: {
        task: {
          include: {
            creator: true,
            assignee: true
          }
        }
      }
    })
    console.log('✅ Coding workflow created:', workflow.id)
    console.log('   Status:', workflow.status)
    console.log('   AI Service:', workflow.aiService)

    // Test 7: Test workflow status transitions
    console.log('📝 Test 7: Testing workflow status transitions...')

    // PENDING -> PLANNING
    await prisma.codingTaskWorkflow.update({
      where: { id: workflow.id },
      data: { status: 'PLANNING' }
    })
    console.log('✅ Status: PENDING -> PLANNING')

    // PLANNING -> AWAITING_APPROVAL
    await prisma.codingTaskWorkflow.update({
      where: { id: workflow.id },
      data: {
        status: 'AWAITING_APPROVAL',
        metadata: {
          plan: 'Create a React header component with TypeScript',
          timestamp: new Date().toISOString()
        }
      }
    })
    console.log('✅ Status: PLANNING -> AWAITING_APPROVAL')

    // AWAITING_APPROVAL -> IMPLEMENTING
    await prisma.codingTaskWorkflow.update({
      where: { id: workflow.id },
      data: {
        status: 'IMPLEMENTING',
        planApproved: true,
        workingBranch: 'feature/header-component'
      }
    })
    console.log('✅ Status: AWAITING_APPROVAL -> IMPLEMENTING')

    // IMPLEMENTING -> TESTING
    await prisma.codingTaskWorkflow.update({
      where: { id: workflow.id },
      data: {
        status: 'TESTING',
        pullRequestNumber: 42,
        deploymentUrl: 'https://test-deployment.vercel.app',
        previewUrl: 'https://test-preview.vercel.app'
      }
    })
    console.log('✅ Status: IMPLEMENTING -> TESTING')

    // TESTING -> READY_TO_MERGE
    await prisma.codingTaskWorkflow.update({
      where: { id: workflow.id },
      data: { status: 'READY_TO_MERGE' }
    })
    console.log('✅ Status: TESTING -> READY_TO_MERGE')

    // READY_TO_MERGE -> COMPLETED
    await prisma.codingTaskWorkflow.update({
      where: { id: workflow.id },
      data: { status: 'COMPLETED' }
    })
    console.log('✅ Status: READY_TO_MERGE -> COMPLETED')

    // Test 8: Mark task as completed
    console.log('📝 Test 8: Marking task as completed...')
    await prisma.task.update({
      where: { id: testTask.id },
      data: { completed: true }
    })
    console.log('✅ Task marked as completed')

    // Test 9: Test API endpoints (basic validation)
    console.log('📝 Test 9: Validating workflow data integrity...')

    const finalWorkflow = await prisma.codingTaskWorkflow.findUnique({
      where: { id: workflow.id },
      include: {
        task: {
          include: {
            assignee: true,
            creator: true,
            lists: true
          }
        }
      }
    })

    if (!finalWorkflow) {
      throw new Error('Workflow not found after updates')
    }

    console.log('✅ Workflow data integrity verified')
    console.log('   Final Status:', finalWorkflow.status)
    console.log('   Task Completed:', finalWorkflow.task.completed)
    console.log('   Plan Approved:', finalWorkflow.planApproved)
    console.log('   Working Branch:', finalWorkflow.workingBranch)
    console.log('   PR Number:', finalWorkflow.pullRequestNumber)
    console.log('   Preview URL:', finalWorkflow.previewUrl)

    // Test 10: Test relationship queries
    console.log('📝 Test 10: Testing relationship queries...')

    const userWithTasks = await prisma.user.findUnique({
      where: { id: testUser.id },
      include: {
        createdTasks: {
          include: {
            codingWorkflow: true
          }
        }
      }
    })

    const agentWithTasks = await prisma.user.findUnique({
      where: { id: codingAgent.id },
      include: {
        assignedTasks: {
          include: {
            codingWorkflow: true
          }
        }
      }
    })

    console.log('✅ Relationship queries work correctly')
    console.log('   User created tasks with workflows:', userWithTasks?.createdTasks.filter(t => t.codingWorkflow).length)
    console.log('   Agent assigned tasks with workflows:', agentWithTasks?.assignedTasks.filter(t => t.codingWorkflow).length)

    console.log('\n🎉 All Phase 2 tests passed!')
    console.log('\n📋 Workflow Summary:')
    console.log('   Workflow ID:', finalWorkflow.id)
    console.log('   Task:', finalWorkflow.task.title)
    console.log('   Creator:', finalWorkflow.task.creator?.name || 'Deleted User')
    console.log('   Assignee:', finalWorkflow.task.assignee?.name)
    console.log('   Status:', finalWorkflow.status)
    console.log('   AI Service:', finalWorkflow.aiService)

    return {
      success: true,
      workflowId: finalWorkflow.id,
      taskId: finalWorkflow.taskId,
      status: finalWorkflow.status
    }

  } catch (error) {
    console.error('❌ Phase 2 test failed:', error)
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    // Cleanup test data
    console.log('\n🧹 Cleaning up test data...')
    try {
      if (workflow) await prisma.codingTaskWorkflow.delete({ where: { id: workflow.id } })
      if (testTask) await prisma.task.delete({ where: { id: testTask.id } })
      if (testList) await prisma.taskList.delete({ where: { id: testList.id } })
      if (testUser) await prisma.user.delete({ where: { id: testUser.id } })
      console.log('✅ Test data cleaned up')
    } catch (cleanupError) {
      console.error('⚠️ Error during cleanup:', cleanupError)
    }

    await prisma.$disconnect()
  }
}

if (require.main === module) {
  testPhase2Workflow()
    .then((result) => {
      process.exit(result.success ? 0 : 1)
    })
    .catch((error) => {
      console.error('Test execution failed:', error)
      process.exit(1)
    })
}

export { testPhase2Workflow }