#!/usr/bin/env npx tsx

/**
 * Local AI Agent Workflow Test
 * Tests the complete AI agent workflow locally without GitHub dependencies
 */

import { PrismaClient } from '@prisma/client'
import { DEFAULT_LIST_COLOR } from '../lib/brand/colors'
import { aiAgentWebhookService } from '@/lib/ai-agent-webhook-service'

const prisma = new PrismaClient()
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'

interface TestResults {
  passed: number
  failed: number
  tests: Array<{
    name: string
    status: 'PASS' | 'FAIL'
    message?: string
    error?: any
  }>
}

class LocalAIAgentTester {
  private results: TestResults = { passed: 0, failed: 0, tests: [] }
  private testUserId: string | null = null
  private testListId: string | null = null
  private testTaskId: string | null = null
  private aiAgentId: string | null = null

  private addResult(name: string, success: boolean, message?: string, error?: any) {
    this.results.tests.push({
      name,
      status: success ? 'PASS' : 'FAIL',
      message,
      error
    })

    if (success) {
      this.results.passed++
      console.log(`✅ ${name}`)
    } else {
      this.results.failed++
      console.log(`❌ ${name}: ${message}`)
      if (error) console.error('  Error:', error)
    }
  }

  async setup() {
    console.log('🚀 Setting up local AI agent test environment...\n')

    try {
      // Get the AI agent
      const aiAgent = await prisma.user.findFirst({
        where: {
          isAIAgent: true,
          aiAgentType: 'claude_agent'
        }
      })

      if (!aiAgent) {
        throw new Error('AI agent not found - run the setup script first')
      }
      this.aiAgentId = aiAgent.id
      console.log(`🤖 Found AI Agent: ${aiAgent.name} (${aiAgent.email})`)
      console.log(`🔗 Webhook URL: ${aiAgent.webhookUrl}`)

      // Create test user
      const testUser = await prisma.user.create({
        data: {
          name: 'Test User',
          email: `test-user-${Date.now()}@example.com`,
          emailVerified: new Date()
        }
      })
      this.testUserId = testUser.id
      console.log(`👤 Created test user: ${testUser.email}`)

      // Create test list
      const testList = await prisma.taskList.create({
        data: {
          color: DEFAULT_LIST_COLOR,
          name: 'AI Agent Test List',
          description: 'Test list for AI agent workflow testing',
          ownerId: this.testUserId
        }
      })
      this.testListId = testList.id
      console.log(`📋 Created test list: ${testList.name}`)

      console.log('✅ Setup complete\n')
    } catch (error) {
      console.error('❌ Setup failed:', error)
      throw error
    }
  }

  async testAIAgentConfiguration() {
    console.log('🧪 Testing AI Agent Configuration...\n')

    try {
      const aiAgent = await prisma.user.findUnique({
        where: { id: this.aiAgentId! }
      })

      this.addResult(
        'AI agent exists',
        !!aiAgent,
        aiAgent ? `Found: ${aiAgent.name}` : 'AI agent not found'
      )

      this.addResult(
        'AI agent is marked as AI agent',
        aiAgent?.isAIAgent === true,
        `isAIAgent: ${aiAgent?.isAIAgent}`
      )

      this.addResult(
        'AI agent has correct type',
        aiAgent?.aiAgentType === 'claude_agent',
        `Type: ${aiAgent?.aiAgentType}`
      )

      this.addResult(
        'AI agent has webhook URL',
        !!aiAgent?.webhookUrl && aiAgent.webhookUrl.includes('/api/ai-agent/webhook'),
        aiAgent?.webhookUrl ? `Webhook: ${aiAgent.webhookUrl}` : 'No webhook URL'
      )

    } catch (error) {
      this.addResult('AI agent configuration test', false, 'Failed to check configuration', error)
    }
  }

  async testTaskAssignmentFlow() {
    console.log('🧪 Testing Task Assignment Flow...\n')

    try {
      // Create a test task assigned to the AI agent
      const task = await prisma.task.create({
        data: {
          title: 'Test Task for AI Agent',
          description: 'This is a test task to verify the AI agent workflow works correctly. Please implement a simple "Hello World" function.',
          priority: 2,
          assigneeId: this.aiAgentId!,
          creatorId: this.testUserId!,
          lists: {
            connect: { id: this.testListId! }
          }
        },
        include: {
          assignee: true,
          creator: true,
          lists: true
        }
      })

      this.testTaskId = task.id
      console.log(`📋 Created test task: "${task.title}"`)

      this.addResult(
        'Test task created',
        !!task.id,
        `Task ID: ${task.id}`
      )

      this.addResult(
        'Task assigned to AI agent',
        task.assigneeId === this.aiAgentId,
        `Assignee: ${task.assignee?.name}`
      )

      // Get initial comment count
      const initialComments = await prisma.comment.count({
        where: { taskId: task.id }
      })

      console.log(`📝 Initial comments: ${initialComments}`)

      // Trigger the AI agent notification
      console.log('🚀 Triggering AI agent notification...')
      await aiAgentWebhookService.notifyTaskAssignment(task.id, this.aiAgentId!)

      // Wait a moment for the webhook to process
      console.log('⏳ Waiting for AI agent response...')
      await new Promise(resolve => setTimeout(resolve, 3000))

      // Check for new comments from the AI agent
      const finalComments = await prisma.comment.findMany({
        where: {
          taskId: task.id,
          authorId: this.aiAgentId!
        },
        orderBy: { createdAt: 'desc' }
      })

      console.log(`📝 Final comments from AI agent: ${finalComments.length}`)

      this.addResult(
        'AI agent posted acknowledgment comment',
        finalComments.length > 0,
        finalComments.length > 0 ? `Posted ${finalComments.length} comments` : 'No comments from AI agent'
      )

      if (finalComments.length > 0) {
        const latestComment = finalComments[0]
        console.log('\n💬 Latest AI agent comment:')
        console.log('---')
        console.log(latestComment.content.substring(0, 200) + '...')
        console.log('---\n')

        this.addResult(
          'AI agent comment contains expected content',
          latestComment.content.includes('AI Coding Agent Activated'),
          'Comment contains activation message'
        )

        this.addResult(
          'AI agent comment is markdown',
          latestComment.type === 'MARKDOWN',
          `Comment type: ${latestComment.type}`
        )
      }

    } catch (error) {
      this.addResult('Task assignment flow test', false, 'Failed to test task assignment', error)
    }
  }

  async testWebhookEndpoint() {
    console.log('🧪 Testing Webhook Endpoint...\n')

    try {
      // Test GET request for documentation
      const getResponse = await fetch(`${BASE_URL}/api/ai-agent/webhook`)
      const getResult = await getResponse.json()

      this.addResult(
        'Webhook endpoint documentation accessible',
        getResponse.ok && getResult.service,
        getResponse.ok ? `Service: ${getResult.service}` : `Error: ${getResponse.status}`
      )

      // Test POST request with invalid payload (should fail gracefully)
      const postResponse = await fetch(`${BASE_URL}/api/ai-agent/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invalid: 'payload' })
      })

      this.addResult(
        'Webhook endpoint validates payloads',
        postResponse.status === 400,
        postResponse.status === 400 ? 'Properly rejected invalid payload' : `Unexpected status: ${postResponse.status}`
      )

    } catch (error) {
      this.addResult('Webhook endpoint test', false, 'Failed to test webhook endpoint', error)
    }
  }

  async testSSEIntegration() {
    console.log('🧪 Testing SSE Integration...\n')

    try {
      // Test SSE endpoint availability
      const sseResponse = await fetch(`${BASE_URL}/api/sse/health`)

      this.addResult(
        'SSE service is available',
        sseResponse.ok,
        sseResponse.ok ? 'SSE service healthy' : `SSE service error: ${sseResponse.status}`
      )

      // Note: Full SSE testing would require a WebSocket/EventSource connection
      // which is complex in a test script. We're just checking availability.

    } catch (error) {
      this.addResult('SSE integration test', false, 'Failed to test SSE integration', error)
    }
  }

  async testMCPIntegration() {
    console.log('🧪 Testing MCP Integration...\n')

    try {
      // Check if AI agent has MCP token
      const mcpToken = await prisma.mCPToken.findFirst({
        where: {
          userId: this.aiAgentId!,
          isActive: true
        }
      })

      this.addResult(
        'AI agent has MCP token',
        !!mcpToken,
        mcpToken ? `Token: ${mcpToken.token.substring(0, 20)}...` : 'No MCP token found'
      )

      if (mcpToken) {
        // Test MCP operations endpoint
        const mcpResponse = await fetch(`${BASE_URL}/api/mcp/operations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operation: 'get_task_details',
            args: {
              accessToken: mcpToken.token,
              taskId: this.testTaskId
            }
          })
        })

        const mcpResult = await mcpResponse.json()

        this.addResult(
          'MCP task details operation works',
          mcpResponse.ok && mcpResult.task,
          mcpResponse.ok ? `Retrieved task: ${mcpResult.task?.title}` : `Error: ${mcpResult.error}`
        )
      }

    } catch (error) {
      this.addResult('MCP integration test', false, 'Failed to test MCP integration', error)
    }
  }

  async cleanup() {
    console.log('\n🧹 Cleaning up test data...')

    try {
      // Delete test task
      if (this.testTaskId) {
        await prisma.comment.deleteMany({ where: { taskId: this.testTaskId } })
        await prisma.task.delete({ where: { id: this.testTaskId } })
        console.log('🗑️ Deleted test task and comments')
      }

      // Delete test list
      if (this.testListId) {
        await prisma.taskList.delete({ where: { id: this.testListId } })
        console.log('🗑️ Deleted test list')
      }

      // Delete test user
      if (this.testUserId) {
        await prisma.user.delete({ where: { id: this.testUserId } })
        console.log('🗑️ Deleted test user')
      }

    } catch (error) {
      console.error('❌ Cleanup failed:', error)
    }
  }

  async runAllTests() {
    console.log('🧪 Starting Local AI Agent Workflow Tests\n')
    console.log('=' .repeat(60))

    try {
      await this.setup()

      await this.testAIAgentConfiguration()
      await this.testTaskAssignmentFlow()
      await this.testWebhookEndpoint()
      await this.testSSEIntegration()
      await this.testMCPIntegration()

    } catch (error) {
      console.error('❌ Test suite failed:', error)
    } finally {
      await this.cleanup()
      await prisma.$disconnect()
    }

    console.log('\n' + '=' .repeat(60))
    console.log('📊 Test Results Summary:')
    console.log(`✅ Passed: ${this.results.passed}`)
    console.log(`❌ Failed: ${this.results.failed}`)
    console.log(`📈 Success Rate: ${((this.results.passed / (this.results.passed + this.results.failed)) * 100).toFixed(1)}%`)

    if (this.results.failed > 0) {
      console.log('\n❌ Failed Tests:')
      this.results.tests
        .filter(test => test.status === 'FAIL')
        .forEach(test => {
          console.log(`  • ${test.name}: ${test.message}`)
        })
    } else {
      console.log('\n🎉 All tests passed! AI Agent workflow is working correctly!')
    }

    console.log('\n🎯 Next Steps:')
    if (this.results.failed === 0) {
      console.log('  • Try assigning a real task to the AI Agent in the web interface')
      console.log('  • Watch for real-time SSE notifications')
      console.log('  • Check task comments for AI agent responses')
    } else {
      console.log('  • Fix the failing tests above')
      console.log('  • Re-run this test script to verify fixes')
    }

    // Exit with error code if tests failed
    if (this.results.failed > 0) {
      process.exit(1)
    }
  }
}

async function main() {
  const tester = new LocalAIAgentTester()
  await tester.runAllTests()
}

if (require.main === module) {
  main().catch(console.error)
}

export { LocalAIAgentTester }