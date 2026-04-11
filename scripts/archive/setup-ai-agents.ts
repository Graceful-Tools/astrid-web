#!/usr/bin/env npx tsx

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

interface AIAgentConfig {
  name: string
  email: string
  agentType: string
  description: string
  requiresApiKey: boolean
  webhookUrl?: string
  defaultConfig: any
}

const AI_AGENTS: AIAgentConfig[] = [
  {
    name: 'Claude AI Assistant',
    email: 'claude@astrid.ai',
    agentType: 'claude',
    description: 'Claude AI Assistant for task management',
    requiresApiKey: true,
    webhookUrl: 'https://astrid.cc/api/webhooks/claude-integration',
    defaultConfig: {
      model: 'claude-3-5-sonnet-20241022',
      maxTokens: 4000,
      capabilities: ['read', 'write', 'comment', 'complete'],
      contextInstructions: 'You are an AI assistant integrated with Astrid Task Manager. When assigned tasks, you can read task details, add comments with updates, and mark tasks as complete. Use the MCP API to interact with tasks.',
      webhookEndpoint: 'https://astrid.cc/api/webhooks/ai-agents',
      mcpEndpoint: 'https://astrid.cc/api/mcp/operations',
      contextEndpoint: 'https://astrid.cc/api/mcp/context'
    }
  },
  {
    name: 'Astrid AI (First-Party)',
    email: 'astrid@astrid.ai',
    agentType: 'astrid',
    description: 'Built-in Astrid AI Assistant (no API key required)',
    requiresApiKey: false,
    defaultConfig: {
      model: 'astrid-alpha',
      capabilities: ['read', 'write', 'comment', 'complete', 'create', 'delete'],
      contextInstructions: 'You are the built-in Astrid AI assistant. You have full access to task management capabilities and can help users organize, prioritize, and complete their tasks.'
    }
  },
  {
    name: 'Google Gemini Assistant',
    email: 'gemini@astrid.ai',
    agentType: 'gemini',
    description: 'Google Gemini AI Assistant for task management',
    requiresApiKey: true,
    webhookUrl: 'https://astrid.cc/api/webhooks/gemini-integration',
    defaultConfig: {
      model: 'gemini-2.0-flash',
      capabilities: ['read', 'write', 'comment', 'complete'],
      contextInstructions: 'You are a Google Gemini AI assistant integrated with Astrid Task Manager. Help users manage their tasks by reading details, providing updates via comments, and marking tasks complete when done.',
      webhookEndpoint: 'https://astrid.cc/api/webhooks/ai-agents',
      mcpEndpoint: 'https://astrid.cc/api/mcp/operations',
      contextEndpoint: 'https://astrid.cc/api/mcp/context'
    }
  },
  {
    name: 'OpenAI Assistant',
    email: 'openai@astrid.ai',
    agentType: 'openai',
    description: 'OpenAI GPT Assistant for task management',
    requiresApiKey: true,
    webhookUrl: 'https://astrid.cc/api/webhooks/openai-integration',
    defaultConfig: {
      // model uses OpenAI API default
      capabilities: ['read', 'write', 'comment', 'complete'],
      contextInstructions: 'You are an OpenAI assistant integrated with Astrid Task Manager. When assigned tasks, use the MCP API to read task details, provide progress updates via comments, and mark tasks complete.',
      webhookEndpoint: 'https://astrid.cc/api/webhooks/ai-agents',
      mcpEndpoint: 'https://astrid.cc/api/mcp/operations',
      contextEndpoint: 'https://astrid.cc/api/mcp/context'
    }
  }
]

async function createAIAgents() {
  console.log('🤖 Setting up AI Agent accounts...')

  for (const agent of AI_AGENTS) {
    try {
      // Check if agent already exists
      const existingAgent = await prisma.user.findUnique({
        where: { email: agent.email }
      })

      if (existingAgent) {
        console.log(`⚠️  AI Agent ${agent.name} (${agent.email}) already exists, updating...`)

        // Update existing agent
        await prisma.user.update({
          where: { email: agent.email },
          data: {
            name: agent.name,
            isAIAgent: true,
            aiAgentType: agent.agentType,
            aiAgentConfig: JSON.stringify(agent.defaultConfig),
            webhookUrl: agent.webhookUrl,
            mcpEnabled: true,
            isActive: true,
            emailVerified: new Date() // AI agents are pre-verified
          }
        })
        console.log(`✅ Updated AI Agent: ${agent.name}`)
      } else {
        // Create new agent
        const newAgent = await prisma.user.create({
          data: {
            name: agent.name,
            email: agent.email,
            isAIAgent: true,
            aiAgentType: agent.agentType,
            aiAgentConfig: JSON.stringify(agent.defaultConfig),
            webhookUrl: agent.webhookUrl,
            mcpEnabled: true,
            isActive: true,
            emailVerified: new Date() // AI agents are pre-verified
          }
        })
        console.log(`✅ Created AI Agent: ${agent.name} (ID: ${newAgent.id})`)
      }
    } catch (error) {
      console.error(`❌ Failed to create AI Agent ${agent.name}:`, error)
    }
  }

  console.log('\n📋 AI Agent Summary:')
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

  aiAgents.forEach(agent => {
    console.log(`  🤖 ${agent.name} (${agent.aiAgentType})`)
    console.log(`     📧 ${agent.email}`)
    console.log(`     🔗 MCP: ${agent.mcpEnabled ? 'Enabled' : 'Disabled'}`)
    if (agent.webhookUrl) {
      console.log(`     🌐 Webhook: ${agent.webhookUrl}`)
    }
    console.log('')
  })

  console.log('🎉 AI Agent setup complete!')
}

async function main() {
  try {
    await createAIAgents()
  } catch (error) {
    console.error('❌ Error setting up AI agents:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  main()
}

export { createAIAgents }