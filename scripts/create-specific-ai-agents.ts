#!/usr/bin/env tsx

import { PrismaClient } from '@prisma/client'
import crypto from 'crypto'
import * as dotenv from 'dotenv'
import * as path from 'path'

// Load .env.local for database URL
dotenv.config({ path: path.join(process.cwd(), '.env.local') })

const prisma = new PrismaClient()

async function createSpecificAIAgents() {
  try {
    console.log('🤖 Creating specific AI agents...')

    // Use Vercel Blob storage for AI agent profile images
    // These images are uploaded via scripts/upload-ai-agent-images.ts
    const blobBase = 'https://uvq3rbgqrtvvavdq.public.blob.vercel-storage.com/ai-agents'

    // Create Claude agent
    const claudeAgent = await prisma.user.upsert({
      where: { email: 'claude@astrid.cc' },
      update: {
        name: 'Claude Agent',
        image: `${blobBase}/claude.png`,
        isAIAgent: true,
        aiAgentType: 'claude_agent',
        isActive: true
      },
      create: {
        email: 'claude@astrid.cc',
        name: 'Claude Agent',
        image: `${blobBase}/claude.png`,
        isAIAgent: true,
        aiAgentType: 'claude_agent',
        isActive: true
      }
    })

    console.log('✅ Claude agent:', claudeAgent.name, '(' + claudeAgent.email + ')')

    // Create OpenAI agent
    const openaiAgent = await prisma.user.upsert({
      where: { email: 'openai@astrid.cc' },
      update: {
        name: 'OpenAI Agent',
        image: `${blobBase}/openai.png`,
        isAIAgent: true,
        aiAgentType: 'openai_agent',
        isActive: true
      },
      create: {
        email: 'openai@astrid.cc',
        name: 'OpenAI Agent',
        image: `${blobBase}/openai.png`,
        isAIAgent: true,
        aiAgentType: 'openai_agent',
        isActive: true
      }
    })

    console.log('✅ OpenAI agent:', openaiAgent.name, '(' + openaiAgent.email + ')')

    // Create Gemini agent
    const geminiAgent = await prisma.user.upsert({
      where: { email: 'gemini@astrid.cc' },
      update: {
        name: 'Gemini Agent',
        image: `${blobBase}/gemini.png`,
        isAIAgent: true,
        aiAgentType: 'gemini_agent',
        isActive: true
      },
      create: {
        email: 'gemini@astrid.cc',
        name: 'Gemini Agent',
        image: `${blobBase}/gemini.png`,
        isAIAgent: true,
        aiAgentType: 'gemini_agent',
        isActive: true
      }
    })

    console.log('✅ Gemini agent:', geminiAgent.name, '(' + geminiAgent.email + ')')

    // Create OpenClaw agent
    const openclawAgent = await prisma.user.upsert({
      where: { email: 'openclaw@astrid.cc' },
      update: {
        name: 'OpenClaw Worker',
        image: `${blobBase}/openclaw.svg`,
        isAIAgent: true,
        aiAgentType: 'openclaw_worker',
        isActive: true
      },
      create: {
        email: 'openclaw@astrid.cc',
        name: 'OpenClaw Worker',
        image: `${blobBase}/openclaw.svg`,
        isAIAgent: true,
        aiAgentType: 'openclaw_worker',
        isActive: true
      }
    })

    console.log('✅ OpenClaw agent:', openclawAgent.name, '(' + openclawAgent.email + ')')

    // Create MCP tokens for each agent
    for (const agent of [claudeAgent, openaiAgent, geminiAgent, openclawAgent]) {
      // Check if token already exists
      const existingToken = await prisma.mCPToken.findFirst({
        where: { userId: agent.id }
      })

      if (!existingToken) {
        const token = crypto.randomBytes(32).toString('hex')
        await prisma.mCPToken.create({
          data: {
            token,
            userId: agent.id,
            description: `${agent.name} MCP Token`,
            permissions: ['read', 'write'],
            isActive: true
          }
        })
        console.log(`🔑 Created MCP token for ${agent.name}`)
      } else {
        console.log(`🔑 MCP token already exists for ${agent.name}`)
      }
    }

    // Note: Legacy cleanup code was removed as the old generic coding agent
    // has been permanently removed from the system

    console.log('')
    console.log('🎯 AI Agent System Ready:')
    console.log('  - Claude Agent: claude@astrid.cc')
    console.log('  - OpenAI Agent: openai@astrid.cc')
    console.log('  - Gemini Agent: gemini@astrid.cc')
    console.log('  - OpenClaw Worker: openclaw@astrid.cc')
    console.log('')
    console.log('Now you can enable these agents in list settings!')

  } catch (error) {
    console.error('❌ Error creating AI agents:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  createSpecificAIAgents().catch(console.error)
}