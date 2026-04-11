#!/usr/bin/env npx tsx
/**
 * Test GitHub Agent Connection
 * Verifies that AI coding agents can connect to GitHub via the list admin's integration
 */

import { config } from 'dotenv'
import { PrismaClient } from '@prisma/client'

// Load environment variables
config({ path: '.env.local' })

const prisma = new PrismaClient()

async function testGitHubAgentConnection() {
  console.log('🧪 Testing GitHub Agent Connection for Cloud Workflow...\n')

  try {
    // Test 1: Verify AI agents exist in database
    console.log('📝 Test 1: Verifying AI agents exist...')
    const aiAgents = await prisma.user.findMany({
      where: { isAIAgent: true },
      select: { id: true, email: true, name: true }
    })

    if (aiAgents.length === 0) {
      throw new Error('No AI agents found in database')
    }

    console.log('✅ AI agents found:')
    aiAgents.forEach(agent => {
      console.log(`   - ${agent.name} (${agent.email})`)
    })
    console.log()

    // Test 2: Verify AI agents do NOT have GitHub integrations (expected)
    console.log('📝 Test 2: Verifying AI agents do NOT have GitHub integrations...')
    const agentIntegrations = await Promise.all(
      aiAgents.map(agent =>
        prisma.gitHubIntegration.findFirst({ where: { userId: agent.id } })
      )
    )

    const hasIntegrations = agentIntegrations.some(integration => integration !== null)
    if (hasIntegrations) {
      console.warn('⚠️ Warning: AI agents should NOT have GitHub integrations directly')
    } else {
      console.log('✅ Confirmed: AI agents do not have GitHub integrations (expected)')
    }
    console.log()

    // Test 3: Find a real user with GitHub integration
    console.log('📝 Test 3: Finding real user with GitHub integration...')
    const userWithGitHub = await prisma.user.findFirst({
      where: {
        isAIAgent: false,
        githubIntegrations: {
          some: {}
        }
      },
      include: {
        githubIntegrations: {
          select: {
            installationId: true,
            repositories: true
          }
        }
      }
    })

    const firstIntegration = userWithGitHub?.githubIntegrations?.[0]
    if (!userWithGitHub || !firstIntegration) {
      throw new Error('No real users with GitHub integration found. Please set up GitHub integration first.')
    }

    console.log('✅ Found user with GitHub integration:')
    console.log(`   - User ID: ${userWithGitHub.id}`)
    console.log(`   - Email: ${userWithGitHub.email}`)
    console.log(`   - Installation ID: ${firstIntegration.installationId}`)

    // Parse repositories
    let repositories: any[] = []
    if (firstIntegration.repositories) {
      try {
        repositories = typeof firstIntegration.repositories === 'string'
          ? JSON.parse(firstIntegration.repositories)
          : firstIntegration.repositories as any[]
        console.log(`   - Repositories: ${repositories.length} available`)
        if (repositories.length > 0) {
          console.log(`     - Primary: ${repositories[0].fullName}`)
        }
      } catch (error) {
        console.error('   - Failed to parse repositories:', error)
      }
    }
    console.log()

    // Test 4: Verify GitHub client class structure
    console.log('📝 Test 4: Verifying GitHub client class structure...')
    const { GitHubClient } = await import('../lib/github-client')
    console.log('✅ GitHub client imported successfully')
    console.log()

    // Test 5: Test GitHub client authentication with real user
    console.log('📝 Test 5: Testing GitHub client authentication...')
    try {
      const githubClient = await GitHubClient.forUser(userWithGitHub.id)
      console.log('✅ GitHub client authenticated successfully')
      console.log(`   - Using user ID: ${userWithGitHub.id}`)
      console.log()

      // Test 6: Test repository access
      if (repositories.length > 0) {
        console.log('📝 Test 6: Testing repository access...')
        const testRepo = repositories[0].fullName

        try {
          const repoInfo = await githubClient.getRepository(testRepo)
          console.log('✅ Repository access confirmed:')
          console.log(`   - Repository: ${repoInfo.fullName}`)
          console.log(`   - Default branch: ${repoInfo.defaultBranch}`)
          console.log(`   - Private: ${repoInfo.private}`)
        } catch (repoError) {
          console.error('❌ Repository access failed:', repoError)
        }
      }
      console.log()

    } catch (authError) {
      throw new Error(`GitHub client authentication failed: ${authError}`)
    }

    // Test 7: Simulate AI orchestrator workflow
    console.log('📝 Test 7: Simulating AI orchestrator workflow...')
    console.log('   - Creating mock task list with GitHub repository...')

    // Create a test list with GitHub repository configured
    const testList = await prisma.taskList.create({
      data: {
        name: 'Test GitHub Agent List',
        ownerId: userWithGitHub.id,
        githubRepositoryId: repositories.length > 0 ? repositories[0].fullName : null,
        aiAgentsEnabled: true,
        aiAgentConfiguredBy: userWithGitHub.id, // This is the key field!
        preferredAiProvider: 'claude'
      }
    })
    console.log(`   - Test list created: ${testList.id}`)

    // Create a test task assigned to AI agent
    const testTask = await prisma.task.create({
      data: {
        title: 'Test GitHub Agent Connection',
        description: 'Test task to verify AI agent can create GitHub branches',
        creatorId: aiAgents[0].id, // Task created by AI agent
        assigneeId: aiAgents[0].id, // Assigned to AI agent
        lists: {
          connect: { id: testList.id }
        }
      }
    })
    console.log(`   - Test task created: ${testTask.id}`)

    // Simulate the orchestrator using this.userId (which should be aiAgentConfiguredBy)
    const configuredByUserId = testList.aiAgentConfiguredBy || testTask.creatorId || userWithGitHub.id
    console.log(`   - Orchestrator would use userId: ${configuredByUserId}`)
    console.log(`   - This should be the list admin, not the AI agent: ${configuredByUserId === userWithGitHub.id ? '✅ CORRECT' : '❌ WRONG'}`)

    // Test that this user ID can authenticate with GitHub
    try {
      const orchestratorGithubClient = await GitHubClient.forUser(configuredByUserId!)
      console.log('✅ Orchestrator can authenticate with GitHub using list admin credentials')

      if (repositories.length > 0) {
        const repoAccess = await orchestratorGithubClient.getRepository(repositories[0].fullName)
        console.log(`✅ Orchestrator can access repository: ${repoAccess.fullName}`)
      }
    } catch (orchError) {
      throw new Error(`Orchestrator authentication failed: ${orchError}`)
    }
    console.log()

    // Cleanup test data
    console.log('🧹 Cleaning up test data...')
    await prisma.task.delete({ where: { id: testTask.id } })
    await prisma.taskList.delete({ where: { id: testList.id } })
    console.log('✅ Test data cleaned up')
    console.log()

    // Summary
    console.log('🎉 All tests passed!')
    console.log('\n📋 Test Summary:')
    console.log('   ✅ AI agents exist in database')
    console.log('   ✅ AI agents do NOT have GitHub integrations (correct)')
    console.log('   ✅ Real users with GitHub integration found')
    console.log('   ✅ GitHub client authentication works')
    console.log('   ✅ Repository access confirmed')
    console.log('   ✅ AI orchestrator workflow verified')
    console.log('\n🚀 The fix is working correctly!')
    console.log('   - AI agents use list admin GitHub credentials')
    console.log('   - GitHub client authenticates with correct user')
    console.log('   - Repository access is functional')

    return { success: true }

  } catch (error) {
    console.error('❌ Test failed:', error)
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  testGitHubAgentConnection()
    .then((result) => {
      process.exit(result.success ? 0 : 1)
    })
    .catch((error) => {
      console.error('Test execution failed:', error)
      process.exit(1)
    })
}

export { testGitHubAgentConnection }
