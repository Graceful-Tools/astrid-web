#!/usr/bin/env npx tsx

import { PrismaClient } from '@prisma/client'
import { getBaseUrl } from '@/lib/base-url'

const prisma = new PrismaClient()

interface AIAgentConfig {
  name: string
  service: string
  agentType: string
  description: string
  config?: any
}

const DEFAULT_AI_AGENTS: AIAgentConfig[] = [
  {
    name: 'Claude Code Agent',
    service: 'claude',
    agentType: 'coding',
    description: 'AI coding assistant powered by Anthropic Claude. Specializes in code analysis, implementation planning, and automated development workflows.',
    config: {
      model: 'claude-3-5-sonnet-20241022',
      capabilities: ['code_analysis', 'implementation', 'testing', 'documentation'],
      maxTokens: 4000
    }
  },
  {
    name: 'OpenAI Code Agent',
    service: 'openai',
    agentType: 'coding',
    description: 'AI coding assistant powered by OpenAI. Provides intelligent code generation, debugging assistance, and development guidance.',
    config: {
      // model uses OpenAI API default
      capabilities: ['code_generation', 'debugging', 'refactoring', 'optimization'],
      maxTokens: 4000
    }
  },
  {
    name: 'Claude Analyst',
    service: 'claude',
    agentType: 'analysis',
    description: 'AI analyst powered by Anthropic Claude. Excels at data analysis, research, and providing detailed insights on complex topics.',
    config: {
      model: 'claude-3-5-sonnet-20241022',
      capabilities: ['data_analysis', 'research', 'insights', 'reporting'],
      maxTokens: 8000
    }
  }
]

async function seedAIAgents() {
  try {
    console.log('🤖 Seeding AI agents...')

    const baseUrl = getBaseUrl()
    const webhookUrl = `${baseUrl}/api/ai-agent/webhook`

    let created = 0
    let updated = 0

    for (const agentConfig of DEFAULT_AI_AGENTS) {
      console.log(`📋 Processing: ${agentConfig.name}`)

      const existingAgent = await prisma.aIAgent.findUnique({
        where: {
          service_agentType: {
            service: agentConfig.service,
            agentType: agentConfig.agentType
          }
        }
      })

      if (existingAgent) {
        // Update existing agent
        await prisma.aIAgent.update({
          where: { id: existingAgent.id },
          data: {
            name: agentConfig.name,
            description: agentConfig.description,
            config: agentConfig.config,
            webhookUrl,
            isActive: true,
            updatedAt: new Date()
          }
        })
        console.log(`  ✅ Updated: ${agentConfig.name}`)
        updated++
      } else {
        // Create new agent
        await prisma.aIAgent.create({
          data: {
            name: agentConfig.name,
            service: agentConfig.service,
            agentType: agentConfig.agentType,
            description: agentConfig.description,
            config: agentConfig.config,
            webhookUrl,
            isActive: true
          }
        })
        console.log(`  ✅ Created: ${agentConfig.name}`)
        created++
      }
    }

    console.log(`\n🎉 AI agent seeding completed!`)
    console.log(`📊 Summary:`)
    console.log(`  • Created: ${created} agents`)
    console.log(`  • Updated: ${updated} agents`)
    console.log(`  • Total active agents: ${created + updated}`)

    // List all active agents
    const allAgents = await prisma.aIAgent.findMany({
      where: { isActive: true },
      select: { name: true, service: true, agentType: true }
    })

    console.log(`\n🤖 Active AI agents:`)
    allAgents.forEach(agent => {
      console.log(`  • ${agent.name} (${agent.service}/${agent.agentType})`)
    })

  } catch (error) {
    console.error('❌ Error seeding AI agents:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

// Main execution
async function main() {
  try {
    await seedAIAgents()
    console.log('\n✅ All AI agents seeded successfully!')
  } catch (error) {
    console.error('❌ AI agent seeding failed:', error)
    process.exit(1)
  }
}

// Only run if called directly
if (require.main === module) {
  main()
}

export { seedAIAgents, DEFAULT_AI_AGENTS }