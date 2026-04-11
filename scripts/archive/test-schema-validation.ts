#!/usr/bin/env npx tsx
/**
 * Phase 1 Testing: Database Schema Validation
 * Tests the new GitHub coding agent models
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function testSchemaValidation() {
  console.log('🧪 Testing GitHub Coding Agent Schema...')

  try {
    // Test 1: Create a test user
    console.log('📝 Test 1: Creating test user...')
    const testUser = await prisma.user.create({
      data: {
        email: 'test-coding-agent@test.com',
        name: 'Test User for Coding Agent',
        isAIAgent: false
      }
    })
    console.log('✅ Test user created:', testUser.id)

    // Test 2: Create GitHubIntegration
    console.log('📝 Test 2: Creating GitHub integration...')
    const githubIntegration = await prisma.gitHubIntegration.create({
      data: {
        userId: testUser.id,
        installationId: 12345,
        appId: 54321,
        privateKey: 'test-encrypted-private-key',
        webhookSecret: 'test-encrypted-webhook-secret',
        repositories: [
          {
            id: 1,
            name: 'test-repo',
            fullName: 'test-user/test-repo',
            defaultBranch: 'main'
          }
        ]
      }
    })
    console.log('✅ GitHub integration created:', githubIntegration.id)

    // Test 3: Create a test task
    console.log('📝 Test 3: Creating test task...')
    const testTask = await prisma.task.create({
      data: {
        title: 'Test Coding Task',
        description: 'Add a simple button component',
        creatorId: testUser.id,
        assigneeId: testUser.id
      }
    })
    console.log('✅ Test task created:', testTask.id)

    // Test 4: Create CodingTaskWorkflow
    console.log('📝 Test 4: Creating coding task workflow...')
    const codingWorkflow = await prisma.codingTaskWorkflow.create({
      data: {
        taskId: testTask.id,
        repositoryId: 'test-user/test-repo',
        baseBranch: 'main',
        status: 'PENDING',
        aiService: 'claude'
      }
    })
    console.log('✅ Coding workflow created:', codingWorkflow.id)

    // Test 5: Test relationships
    console.log('📝 Test 5: Testing relationships...')
    const userWithIntegration = await prisma.user.findUnique({
      where: { id: testUser.id },
      include: { githubIntegrations: true }
    })
    console.log('✅ User-GitHub integration relationship works')

    const taskWithWorkflow = await prisma.task.findUnique({
      where: { id: testTask.id },
      include: { codingWorkflow: true }
    })
    console.log('✅ Task-Workflow relationship works')

    // Test 6: Test workflow status enum
    console.log('📝 Test 6: Testing workflow status updates...')
    await prisma.codingTaskWorkflow.update({
      where: { id: codingWorkflow.id },
      data: { status: 'PLANNING' }
    })

    await prisma.codingTaskWorkflow.update({
      where: { id: codingWorkflow.id },
      data: { status: 'AWAITING_APPROVAL' }
    })

    await prisma.codingTaskWorkflow.update({
      where: { id: codingWorkflow.id },
      data: { status: 'IMPLEMENTING' }
    })
    console.log('✅ Workflow status enum values work correctly')

    // Test 7: Test complex data types
    console.log('📝 Test 7: Testing complex data types...')
    await prisma.codingTaskWorkflow.update({
      where: { id: codingWorkflow.id },
      data: {
        workingBranch: 'feature/test-button',
        pullRequestNumber: 42,
        planApproved: true,
        deploymentUrl: 'https://test-deployment.vercel.app',
        previewUrl: 'https://test-preview.vercel.app',
        metadata: {
          testData: 'This is test metadata',
          step: 'implementation',
          timestamp: new Date().toISOString()
        }
      }
    })
    console.log('✅ Complex data types (Json, Boolean, Int) work correctly')

    // Cleanup
    console.log('🧹 Cleaning up test data...')
    await prisma.codingTaskWorkflow.delete({ where: { id: codingWorkflow.id } })
    await prisma.task.delete({ where: { id: testTask.id } })
    await prisma.gitHubIntegration.delete({ where: { id: githubIntegration.id } })
    await prisma.user.delete({ where: { id: testUser.id } })
    console.log('✅ Test data cleaned up')

    console.log('\n🎉 All schema validation tests passed!')
    return true

  } catch (error) {
    console.error('❌ Schema validation test failed:', error)
    return false
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  testSchemaValidation()
    .then((success) => {
      process.exit(success ? 0 : 1)
    })
    .catch((error) => {
      console.error('Test execution failed:', error)
      process.exit(1)
    })
}

export { testSchemaValidation }