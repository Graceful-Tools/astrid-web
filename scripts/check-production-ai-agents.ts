#!/usr/bin/env tsx

import { PrismaClient } from '@prisma/client'
import * as dotenv from 'dotenv'
import * as path from 'path'
import { loadScriptEnv } from './lib/load-env'

// Load .env.local for production DB URL
loadScriptEnv()

// Use production DB if available, otherwise local
const productionDbUrl = process.env.PRODUCTION_DATABASE_URL || process.env.DATABASE_URL

if (!productionDbUrl) {
  console.error('❌ No DATABASE_URL or PRODUCTION_DATABASE_URL found in .env.local')
  process.exit(1)
}

const prisma = new PrismaClient()

async function checkProductionAIAgents() {
  try {
    console.log('🔍 Checking production AI agent users...\n')

    // Check for Claude agent
    const claudeAgent = await prisma.user.findUnique({
      where: { email: 'claude@astrid.cc' },
      select: {
        id: true,
        email: true,
        name: true,
        isAIAgent: true,
        aiAgentType: true,
        isActive: true,
        createdAt: true
      }
    })

    // Check for OpenAI agent
    const openaiAgent = await prisma.user.findUnique({
      where: { email: 'openai-codex@astrid.cc' },
      select: {
        id: true,
        email: true,
        name: true,
        isAIAgent: true,
        aiAgentType: true,
        isActive: true,
        createdAt: true
      }
    })

    // Check for any other AI agents
    const allAIAgents = await prisma.user.findMany({
      where: { isAIAgent: true },
      select: {
        id: true,
        email: true,
        name: true,
        isAIAgent: true,
        aiAgentType: true,
        isActive: true,
        createdAt: true
      },
      orderBy: { createdAt: 'asc' }
    })

    // Check for the fallback ID mentioned in code
    const fallbackClaude = await prisma.user.findUnique({
      where: { id: 'ai-agent-claude' },
      select: {
        id: true,
        email: true,
        name: true,
        isAIAgent: true,
        aiAgentType: true,
        isActive: true
      }
    })

    console.log('📊 Production AI Agent Users:')
    console.log('=' .repeat(60))
    
    if (claudeAgent) {
      console.log('\n✅ Claude Agent:')
      console.log(`   ID: ${claudeAgent.id}`)
      console.log(`   Email: ${claudeAgent.email}`)
      console.log(`   Name: ${claudeAgent.name}`)
      console.log(`   Type: ${claudeAgent.aiAgentType}`)
      console.log(`   Active: ${claudeAgent.isActive}`)
      console.log(`   Created: ${claudeAgent.createdAt}`)
    } else {
      console.log('\n❌ Claude Agent: NOT FOUND')
    }

    if (openaiAgent) {
      console.log('\n✅ OpenAI Agent:')
      console.log(`   ID: ${openaiAgent.id}`)
      console.log(`   Email: ${openaiAgent.email}`)
      console.log(`   Name: ${openaiAgent.name}`)
      console.log(`   Type: ${openaiAgent.aiAgentType}`)
      console.log(`   Active: ${openaiAgent.isActive}`)
      console.log(`   Created: ${openaiAgent.createdAt}`)
    } else {
      console.log('\n❌ OpenAI Agent: NOT FOUND')
    }

    if (fallbackClaude) {
      console.log('\n⚠️  Fallback Claude Agent (ai-agent-claude):')
      console.log(`   ID: ${fallbackClaude.id}`)
      console.log(`   Email: ${fallbackClaude.email || 'N/A'}`)
      console.log(`   Name: ${fallbackClaude.name}`)
      console.log(`   Type: ${fallbackClaude.aiAgentType}`)
      console.log(`   Active: ${fallbackClaude.isActive}`)
    }

    if (allAIAgents.length > 0) {
      console.log(`\n📋 All AI Agents (${allAIAgents.length} total):`)
      allAIAgents.forEach(agent => {
        console.log(`   • ${agent.name} (${agent.email || 'no email'}) - ${agent.id}`)
      })
    } else {
      console.log('\n⚠️  No AI agent users found in production database')
    }

    console.log('\n' + '='.repeat(60))
    console.log('\n💡 To create these locally, run:')
    console.log('   pnpm tsx scripts/create-specific-ai-agents.ts')

  } catch (error) {
    console.error('❌ Error checking production AI agents:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  checkProductionAIAgents().catch(console.error)
}

export { checkProductionAIAgents }

