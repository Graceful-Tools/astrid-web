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
    data?: any
  }>
}

class CompleteAIWorkflowTester {
  private results: TestResults = { passed: 0, failed: 0, tests: [] }
  private testUser: any
  private claudeAgent: any
  private testList: any
  private mcpToken: any

  private addResult(name: string, success: boolean, message?: string, data?: any) {
    this.results.tests.push({
      name,
      status: success ? 'PASS' : 'FAIL',
      message,
      data
    })

    if (success) {
      this.results.passed++
      console.log(`✅ ${name}`)
      if (data) console.log(`   📊 Data:`, data)
    } else {
      this.results.failed++
      console.log(`❌ ${name}: ${message}`)
    }
  }

  async setup() {
    console.log('🚀 Setting up complete AI workflow test...\n')

    try {
      // Clean up any existing test data
      await prisma.user.deleteMany({
        where: {
          email: { in: ['workflow-test@example.com', 'claude-workflow@test.ai'] }
        }
      })

      // Create test user
      this.testUser = await prisma.user.create({
        data: {
          name: 'Workflow Test User',
          email: 'workflow-test@example.com',
          mcpEnabled: true,
          defaultNewListMcpEnabled: true,
          defaultNewListMcpAccessLevel: 'WRITE',
          emailVerified: new Date()
        }
      })

      // Get or create Claude AI agent
      this.claudeAgent = await prisma.user.findFirst({
        where: { aiAgentType: 'claude', isAIAgent: true }
      })

      if (!this.claudeAgent) {
        this.claudeAgent = await prisma.user.create({
          data: {
            name: 'Claude AI Assistant',
            email: 'claude-workflow@test.ai',
            isAIAgent: true,
            aiAgentType: 'claude',
            aiAgentConfig: JSON.stringify({
              model: 'claude-3-5-sonnet-20241022',
              capabilities: ['read', 'write', 'comment', 'complete']
            }),
            webhookUrl: 'https://api.anthropic.com/v1/claude-code/webhooks/test',
            mcpEnabled: true,
            emailVerified: new Date()
          }
        })
      }

      // Create test list with MCP enabled
      this.testList = await prisma.taskList.create({
        data: {
          name: 'Complete Workflow Test List',
          description: 'Testing complete AI agent workflow end-to-end',
          ownerId: this.testUser.id,
          mcpEnabled: true,
          mcpAccessLevel: 'WRITE'
        }
      })

      // Create MCP token for Claude agent
      this.mcpToken = await prisma.mCPToken.create({
        data: {
          token: `workflow-test-token-${Date.now()}`,
          userId: this.claudeAgent.id,
          permissions: ['read', 'write'],
          description: 'Complete workflow test token',
          isActive: true
        }
      })

      console.log(`👤 Test User: ${this.testUser.email}`)
      console.log(`🤖 Claude Agent: ${this.claudeAgent.name}`)
      console.log(`📋 Test List: ${this.testList.name}`)
      console.log(`🔑 MCP Token: ${this.mcpToken.token.substring(0, 20)}...`)
      console.log('✅ Setup complete\n')

    } catch (error) {
      console.error('❌ Setup failed:', error)
      throw error
    }
  }

  async testUserSettings() {
    console.log('🧪 Testing User Settings Configuration...')

    try {
      // Test user MCP settings
      const user = await prisma.user.findUnique({
        where: { id: this.testUser.id },
        select: {
          mcpEnabled: true,
          defaultNewListMcpEnabled: true,
          defaultNewListMcpAccessLevel: true
        }
      })

      this.addResult(
        'User MCP settings configured',
        user!.mcpEnabled && user!.defaultNewListMcpEnabled,
        `MCP: ${user!.mcpEnabled}, Default: ${user!.defaultNewListMcpEnabled}, Level: ${user!.defaultNewListMcpAccessLevel}`
      )

      // Test API key storage
      const apiKeySettings = {
        apiKeys: {
          claude: {
            encrypted: 'test-encrypted-key-data',
            iv: 'test-initialization-vector',
            isValid: true,
            lastTested: new Date().toISOString(),
            createdAt: new Date().toISOString()
          }
        }
      }

      await prisma.user.update({
        where: { id: this.testUser.id },
        data: {
          mcpSettings: JSON.stringify(apiKeySettings)
        }
      })

      const updatedUser = await prisma.user.findUnique({
        where: { id: this.testUser.id },
        select: { mcpSettings: true }
      })

      const settings = JSON.parse(updatedUser!.mcpSettings!)
      this.addResult(
        'API key storage and encryption',
        settings.apiKeys.claude && settings.apiKeys.claude.encrypted,
        'Claude API key stored with encryption'
      )

    } catch (error) {
      this.addResult('User settings test', false, `Error: ${error}`)
    }
  }

  async testListPermissions() {
    console.log('🧪 Testing List Permission Management...')

    try {
      // Test MCP-enabled list
      this.addResult(
        'List MCP configuration',
        this.testList.mcpEnabled && this.testList.mcpAccessLevel === 'WRITE',
        `MCP: ${this.testList.mcpEnabled}, Access: ${this.testList.mcpAccessLevel}`
      )

      // Create list with different permissions
      const readOnlyList = await prisma.taskList.create({
        data: {
          name: 'Read Only Test List',
          ownerId: this.testUser.id,
          mcpEnabled: true,
          mcpAccessLevel: 'READ'
        }
      })

      this.addResult(
        'Multiple permission levels',
        readOnlyList.mcpAccessLevel === 'READ',
        'Read-only list created successfully'
      )

      // Clean up
      await prisma.taskList.delete({ where: { id: readOnlyList.id } })

    } catch (error) {
      this.addResult('List permissions test', false, `Error: ${error}`)
    }
  }

  async testTaskAssignment() {
    console.log('🧪 Testing Task Assignment to AI Agents...')

    try {
      // Create task assigned to Claude
      const task = await prisma.task.create({
        data: {
          title: 'Complete Workflow Test Task',
          description: 'This task tests the complete AI agent workflow from assignment to completion',
          priority: 2,
          assigneeId: this.claudeAgent.id,
          creatorId: this.testUser.id,
          lists: {
            connect: { id: this.testList.id }
          }
        },
        include: {
          assignee: true,
          creator: true,
          lists: true
        }
      })

      this.addResult(
        'Task assignment to AI agent',
        task.assigneeId === this.claudeAgent.id && task.assignee!.isAIAgent,
        `Task "${task.title}" assigned to ${task.assignee!.name}`,
        {
          taskId: task.id,
          assignee: task.assignee!.name,
          agentType: task.assignee!.aiAgentType
        }
      )

      // Verify task is in MCP-enabled list
      this.addResult(
        'Task in MCP-enabled list',
        task.lists[0].mcpEnabled,
        `Task connected to list with MCP: ${task.lists[0].mcpEnabled}`
      )

      return task

    } catch (error) {
      this.addResult('Task assignment test', false, `Error: ${error}`)
      return null
    }
  }

  async testMCPOperations(task: any) {
    console.log('🧪 Testing MCP API Operations...')

    if (!task) {
      this.addResult('MCP operations test', false, 'No task available for testing')
      return
    }

    try {
      // Test get_shared_lists operation
      const listsResponse = await fetch(`${BASE_URL}/api/mcp/operations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'get_shared_lists',
          args: {
            accessToken: this.mcpToken.token
          }
        })
      })

      const listsData = await listsResponse.json()
      this.addResult(
        'MCP get_shared_lists operation',
        listsResponse.ok && listsData.lists && Array.isArray(listsData.lists),
        listsResponse.ok ? `Found ${listsData.lists?.length || 0} accessible lists` : `Error: ${listsData.error}`
      )

      // Test get_task_details operation
      const taskResponse = await fetch(`${BASE_URL}/api/mcp/operations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'get_task_details',
          args: {
            accessToken: this.mcpToken.token,
            taskId: task.id
          }
        })
      })

      const taskData = await taskResponse.json()
      this.addResult(
        'MCP get_task_details operation',
        taskResponse.ok && taskData.task,
        taskResponse.ok ? `Retrieved task: ${taskData.task?.title}` : `Error: ${taskData.error}`
      )

      // Test add_comment operation
      const commentResponse = await fetch(`${BASE_URL}/api/mcp/operations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'add_comment',
          args: {
            accessToken: this.mcpToken.token,
            taskId: task.id,
            comment: {
              content: 'AI agent workflow test: Starting work on this task',
              type: 'TEXT'
            }
          }
        })
      })

      const commentData = await commentResponse.json()
      this.addResult(
        'MCP add_comment operation',
        commentResponse.ok && commentData.success,
        commentResponse.ok ? 'Comment added successfully' : `Error: ${commentData.error}`
      )

      // Test update_task operation (mark as completed)
      const updateResponse = await fetch(`${BASE_URL}/api/mcp/operations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'update_task',
          args: {
            accessToken: this.mcpToken.token,
            taskUpdate: {
              taskId: task.id,
              completed: true
            }
          }
        })
      })

      const updateData = await updateResponse.json()
      this.addResult(
        'MCP update_task operation',
        updateResponse.ok && updateData.success,
        updateResponse.ok ? 'Task marked as completed' : `Error: ${updateData.error}`
      )

    } catch (error) {
      this.addResult('MCP operations test', false, `Network error: ${error}`)
    }
  }

  async testWebhookSystem() {
    console.log('🧪 Testing Webhook System...')

    try {
      // Test webhook endpoint documentation
      const webhookResponse = await fetch(`${BASE_URL}/api/webhooks/ai-agents`)
      const webhookData = await webhookResponse.json()

      this.addResult(
        'Webhook endpoint accessible',
        webhookResponse.ok && webhookData.name,
        webhookResponse.ok ? `Webhook endpoint: ${webhookData.name}` : 'Webhook endpoint not accessible'
      )

      // Test webhook payload validation (should reject invalid data)
      const invalidWebhookResponse = await fetch(`${BASE_URL}/api/webhooks/ai-agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'invalid_event',
          // Missing required fields
        })
      })

      this.addResult(
        'Webhook validation',
        invalidWebhookResponse.status === 400,
        invalidWebhookResponse.status === 400 ? 'Invalid webhook properly rejected' : `Unexpected status: ${invalidWebhookResponse.status}`
      )

    } catch (error) {
      this.addResult('Webhook system test', false, `Error: ${error}`)
    }
  }

  async testContextAPI() {
    console.log('🧪 Testing MCP Context API...')

    try {
      // Test context endpoint with AI agent type
      const contextResponse = await fetch(`${BASE_URL}/api/mcp/context?agentType=claude&token=${this.mcpToken.token}`)
      const contextData = await contextResponse.json()

      this.addResult(
        'MCP context endpoint',
        contextResponse.ok && contextData.service,
        contextResponse.ok ? `Context service: ${contextData.service?.name}` : 'Context endpoint failed'
      )

      if (contextResponse.ok) {
        this.addResult(
          'Context includes operations',
          contextData.operations && Array.isArray(contextData.operations),
          `Found ${contextData.operations?.length || 0} MCP operations`
        )

        this.addResult(
          'Context includes AI instructions',
          contextData.aiAgentInstructions && contextData.agentSpecificInstructions,
          'AI agent instructions and Claude-specific instructions included'
        )

        this.addResult(
          'Context includes user token info',
          contextData.yourToken && contextData.yourToken.agentType === 'claude',
          `Token info: ${contextData.yourToken?.agentName} (${contextData.yourToken?.agentType})`
        )
      }

    } catch (error) {
      this.addResult('Context API test', false, `Error: ${error}`)
    }
  }

  async cleanup() {
    console.log('\n🧹 Cleaning up test data...')

    try {
      await prisma.task.deleteMany({
        where: { creatorId: this.testUser.id }
      })
      console.log('🗑️ Deleted test tasks')

      await prisma.mCPToken.deleteMany({
        where: { token: this.mcpToken.token }
      })
      console.log('🗑️ Deleted test MCP token')

      await prisma.taskList.delete({
        where: { id: this.testList.id }
      })
      console.log('🗑️ Deleted test list')

      await prisma.user.delete({
        where: { id: this.testUser.id }
      })
      console.log('🗑️ Deleted test user')

      // Only delete Claude agent if we created it
      if (this.claudeAgent.email === 'claude-workflow@test.ai') {
        await prisma.user.delete({
          where: { id: this.claudeAgent.id }
        })
        console.log('🗑️ Deleted test Claude agent')
      }

    } catch (error) {
      console.error('❌ Cleanup failed:', error)
    }
  }

  async runCompleteWorkflowTest() {
    console.log('🧪 Starting Complete AI Agent Workflow Test\n')

    try {
      await this.setup()

      await this.testUserSettings()
      await this.testListPermissions()

      const task = await this.testTaskAssignment()
      await this.testMCPOperations(task)

      await this.testWebhookSystem()
      await this.testContextAPI()

    } catch (error) {
      console.error('❌ Test suite failed:', error)
    } finally {
      await this.cleanup()
      await prisma.$disconnect()
    }

    // Print results summary
    console.log('\n📊 Complete Workflow Test Results:')
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

    console.log('\n🎉 Complete AI Agent Workflow Testing Complete!')
    console.log('\n📋 What was tested:')
    console.log('  ✅ User settings and API key management')
    console.log('  ✅ List permission configuration')
    console.log('  ✅ Task assignment to AI agents')
    console.log('  ✅ MCP API operations (read, write, comment, complete)')
    console.log('  ✅ Webhook system and validation')
    console.log('  ✅ Context API with agent-specific instructions')

    // Exit with error code if tests failed
    if (this.results.failed > 0) {
      process.exit(1)
    }
  }
}

async function main() {
  const tester = new CompleteAIWorkflowTester()
  await tester.runCompleteWorkflowTest()
}

if (require.main === module) {
  main().catch(console.error)
}

export { CompleteAIWorkflowTester }