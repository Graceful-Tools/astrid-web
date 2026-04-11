#!/usr/bin/env npx tsx

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000'

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

class AIAgentWorkflowTester {
  private results: TestResults = { passed: 0, failed: 0, tests: [] }
  private testUserId: string | null = null
  private testListId: string | null = null
  private testTaskId: string | null = null
  private claudeAgentId: string | null = null
  private mcpToken: string | null = null

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
    console.log('🚀 Setting up test environment...')

    try {
      // Create test user
      const testUser = await prisma.user.create({
        data: {
          name: 'Test User',
          email: `test-user-${Date.now()}@example.com`,
          emailVerified: new Date(),
          mcpEnabled: true
        }
      })
      this.testUserId = testUser.id
      console.log(`👤 Created test user: ${testUser.email}`)

      // Get Claude AI agent
      const claudeAgent = await prisma.user.findFirst({
        where: {
          isAIAgent: true,
          aiAgentType: 'claude'
        }
      })

      if (!claudeAgent) {
        throw new Error('Claude AI agent not found')
      }
      this.claudeAgentId = claudeAgent.id
      console.log(`🤖 Found Claude AI agent: ${claudeAgent.name}`)

      // Create test list
      const testList = await prisma.taskList.create({
        data: {
          name: 'AI Agent Test List',
          description: 'Test list for AI agent workflow',
          ownerId: this.testUserId,
          mcpEnabled: true,
          mcpAccessLevel: 'WRITE'
        }
      })
      this.testListId = testList.id
      console.log(`📋 Created test list: ${testList.name}`)

      // Create MCP token for Claude agent
      const token = await prisma.mCPToken.create({
        data: {
          token: `test-claude-token-${Date.now()}`,
          userId: this.claudeAgentId,
          permissions: ['read', 'write'],
          description: 'Test token for Claude AI workflow',
          isActive: true
        }
      })
      this.mcpToken = token.token
      console.log(`🔑 Created MCP token for Claude agent`)

      console.log('✅ Setup complete\n')
    } catch (error) {
      console.error('❌ Setup failed:', error)
      throw error
    }
  }

  async testAIAgentAccounts() {
    console.log('🧪 Testing AI Agent Accounts...')

    try {
      const aiAgents = await prisma.user.findMany({
        where: { isAIAgent: true },
        select: {
          id: true,
          name: true,
          email: true,
          aiAgentType: true,
          webhookUrl: true,
          mcpEnabled: true
        }
      })

      const expectedAgents = ['claude', 'astrid', 'gemini', 'openai']

      this.addResult(
        'AI agents exist',
        aiAgents.length >= 4,
        `Found ${aiAgents.length} AI agents`
      )

      for (const agentType of expectedAgents) {
        const agent = aiAgents.find(a => a.aiAgentType === agentType)
        this.addResult(
          `${agentType} agent exists`,
          !!agent,
          agent ? `Found: ${agent.name}` : `Missing ${agentType} agent`
        )
      }

      // Test Claude agent specifically
      const claudeAgent = aiAgents.find(a => a.aiAgentType === 'claude')
      if (claudeAgent) {
        this.addResult(
          'Claude agent has webhook URL',
          !!claudeAgent.webhookUrl,
          claudeAgent.webhookUrl ? `Webhook: ${claudeAgent.webhookUrl}` : 'No webhook URL'
        )

        this.addResult(
          'Claude agent has MCP enabled',
          claudeAgent.mcpEnabled,
          `MCP enabled: ${claudeAgent.mcpEnabled}`
        )
      }

    } catch (error) {
      this.addResult('AI agent account test', false, 'Failed to query AI agents', error)
    }
  }

  async testTaskAssignment() {
    console.log('🧪 Testing Task Assignment to AI Agent...')

    try {
      // Create task assigned to Claude
      const task = await prisma.task.create({
        data: {
          title: 'Test Task for Claude AI',
          description: 'This is a test task to verify AI agent workflow',
          priority: 2,
          assigneeId: this.claudeAgentId!,
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

      this.addResult(
        'Task created with AI agent assignee',
        task.assigneeId === this.claudeAgentId,
        `Task assigned to: ${task.assignee?.name}`
      )

      this.addResult(
        'Task connected to MCP-enabled list',
        task.lists.some(list => list.mcpEnabled),
        `List MCP enabled: ${task.lists[0]?.mcpEnabled}`
      )

    } catch (error) {
      this.addResult('Task assignment test', false, 'Failed to create task', error)
    }
  }

  async testMCPOperations() {
    console.log('🧪 Testing MCP Operations...')

    if (!this.mcpToken || !this.testTaskId) {
      this.addResult('MCP operations test', false, 'Missing token or task ID for testing')
      return
    }

    // Test get_shared_lists
    try {
      const response = await fetch(`${BASE_URL}/api/mcp/operations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'get_shared_lists',
          args: {
            accessToken: this.mcpToken
          }
        })
      })

      const data = await response.json() as any

      this.addResult(
        'get_shared_lists operation',
        response.ok && data.lists && Array.isArray(data.lists),
        response.ok ? `Found ${data.lists?.length || 0} lists` : `Error: ${data.error}`
      )
    } catch (error) {
      this.addResult('get_shared_lists operation', false, 'Request failed', error)
    }

    // Test get_task_details
    try {
      const response = await fetch(`${BASE_URL}/api/mcp/operations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'get_task_details',
          args: {
            accessToken: this.mcpToken,
            taskId: this.testTaskId
          }
        })
      })

      const data = await response.json() as any

      this.addResult(
        'get_task_details operation',
        response.ok && data.task,
        response.ok ? `Retrieved task: ${data.task?.title}` : `Error: ${data.error}`
      )
    } catch (error) {
      this.addResult('get_task_details operation', false, 'Request failed', error)
    }

    // Test add_comment
    try {
      const response = await fetch(`${BASE_URL}/api/mcp/operations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'add_comment',
          args: {
            accessToken: this.mcpToken,
            taskId: this.testTaskId,
            comment: {
              content: 'Test comment from AI agent workflow test',
              type: 'TEXT'
            }
          }
        })
      })

      const data = await response.json() as any

      this.addResult(
        'add_comment operation',
        response.ok && data.success,
        response.ok ? 'Comment added successfully' : `Error: ${data.error}`
      )
    } catch (error) {
      this.addResult('add_comment operation', false, 'Request failed', error)
    }

    // Test update_task
    try {
      const response = await fetch(`${BASE_URL}/api/mcp/operations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'update_task',
          args: {
            accessToken: this.mcpToken,
            taskUpdate: {
              taskId: this.testTaskId,
              completed: true
            }
          }
        })
      })

      const data = await response.json() as any

      this.addResult(
        'update_task operation',
        response.ok && data.success,
        response.ok ? 'Task updated successfully' : `Error: ${data.error}`
      )
    } catch (error) {
      this.addResult('update_task operation', false, 'Request failed', error)
    }
  }

  async testContextEndpoint() {
    console.log('🧪 Testing MCP Context Endpoint...')

    try {
      const response = await fetch(`${BASE_URL}/api/mcp/context?agentType=claude&token=${this.mcpToken}`)
      const data = await response.json() as any

      this.addResult(
        'Context endpoint accessible',
        response.ok,
        response.ok ? 'Context retrieved successfully' : `Error: ${response.status}`
      )

      if (response.ok) {
        this.addResult(
          'Context has service info',
          !!data.service && !!data.service.name,
          `Service: ${data.service?.name}`
        )

        this.addResult(
          'Context has operations list',
          !!data.operations && Array.isArray(data.operations),
          `Found ${data.operations?.length || 0} operations`
        )

        this.addResult(
          'Context has AI agent instructions',
          !!data.aiAgentInstructions,
          'AI agent instructions included'
        )

        this.addResult(
          'Context has agent-specific instructions',
          !!data.agentSpecificInstructions,
          `Agent type: ${data.agentSpecificInstructions?.platform}`
        )
      }
    } catch (error) {
      this.addResult('Context endpoint test', false, 'Request failed', error)
    }
  }

  async testWebhookEndpoint() {
    console.log('🧪 Testing Webhook Endpoint...')

    // Test GET (documentation)
    try {
      const response = await fetch(`${BASE_URL}/api/webhooks/ai-agents`)
      const data = await response.json() as any

      this.addResult(
        'Webhook documentation endpoint',
        response.ok && data.name,
        response.ok ? `Documentation: ${data.name}` : 'Failed to get documentation'
      )
    } catch (error) {
      this.addResult('Webhook documentation test', false, 'Request failed', error)
    }

    // Test invalid webhook payload (should fail gracefully)
    try {
      const response = await fetch(`${BASE_URL}/api/webhooks/ai-agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'invalid_event',
          // Missing required fields
        })
      })

      this.addResult(
        'Webhook validation',
        response.status === 400,
        response.status === 400 ? 'Properly rejected invalid payload' : `Unexpected status: ${response.status}`
      )
    } catch (error) {
      this.addResult('Webhook validation test', false, 'Request failed', error)
    }
  }

  async cleanup() {
    console.log('\n🧹 Cleaning up test data...')

    try {
      // Delete test task
      if (this.testTaskId) {
        await prisma.task.delete({ where: { id: this.testTaskId } })
        console.log('🗑️ Deleted test task')
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

      // Delete test MCP token
      if (this.mcpToken) {
        await prisma.mCPToken.deleteMany({ where: { token: this.mcpToken } })
        console.log('🗑️ Deleted test MCP token')
      }

    } catch (error) {
      console.error('❌ Cleanup failed:', error)
    }
  }

  async runAllTests() {
    console.log('🧪 Starting AI Agent Workflow Tests\n')

    try {
      await this.setup()

      await this.testAIAgentAccounts()
      await this.testTaskAssignment()
      await this.testMCPOperations()
      await this.testContextEndpoint()
      await this.testWebhookEndpoint()

    } catch (error) {
      console.error('❌ Test suite failed:', error)
    } finally {
      await this.cleanup()
      await prisma.$disconnect()
    }

    console.log('\n📊 Test Results Summary:')
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
    }

    console.log('\n🎉 AI Agent Workflow Testing Complete!')

    // Exit with error code if tests failed
    if (this.results.failed > 0) {
      process.exit(1)
    }
  }
}

async function main() {
  const tester = new AIAgentWorkflowTester()
  await tester.runAllTests()
}

if (require.main === module) {
  main().catch(console.error)
}

export { AIAgentWorkflowTester }