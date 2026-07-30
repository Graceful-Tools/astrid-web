#!/usr/bin/env tsx
/**
 * Seed the User rows backing the built-in AI agents, plus an MCP token for each.
 *
 * Task 97208a72: this used to be five near-identical upsert blocks with hardcoded
 * `claude@astrid.cc`-style addresses, so adding or renaming an agent meant editing the
 * script, the routing registry, and two API routes in lockstep. It now iterates the
 * registry, which means it also honours BRAND_ENABLED_AGENTS and the configured
 * agent-email domain.
 *
 * Seeding remains optional — lib/ai/ensure-agent-user.ts creates rows lazily — but
 * running it up front also issues each agent its MCP token.
 */

import { PrismaClient } from '@prisma/client'
import crypto from 'crypto'
import { loadScriptEnv } from './lib/load-env'
import { ENABLED_AGENT_MAILBOXES, AI_AGENT_CONFIG } from '../lib/ai/agent-config'
import { agentEmail } from '../lib/brand/agent-emails'

// Load .env.local for database URL
loadScriptEnv()

const prisma = new PrismaClient()

// AI agent profile images, uploaded via scripts/upload-ai-agent-images.ts
const BLOB_BASE = 'https://uvq3rbgqrtvvavdq.public.blob.vercel-storage.com/ai-agents'

/** Seed display name and image file per agent — distinct from the routing displayName. */
const SEED_PROFILE: Record<string, { name: string; image: string }> = {
  claude: { name: 'Claude Agent', image: 'claude.png' },
  openai: { name: 'OpenAI Agent', image: 'openai.png' },
  gemini: { name: 'Gemini Agent', image: 'gemini.png' },
  copilot: { name: 'GitHub Copilot Agent', image: 'copilot.png' },
  openclaw: { name: 'OpenClaw Worker', image: 'openclaw.svg' },
}

async function createSpecificAIAgents() {
  try {
    console.log('🤖 Creating specific AI agents...')

    // The default assistant is seeded by ensureAstridAgent() on first use and has no
    // provider image of its own, so it is not seeded here.
    const mailboxes = ENABLED_AGENT_MAILBOXES.filter((m) => m !== 'astrid' && m in SEED_PROFILE)
    const agents = []

    for (const mailbox of mailboxes) {
      const email = agentEmail(mailbox)
      const profile = SEED_PROFILE[mailbox]
      const fields = {
        name: profile.name,
        image: `${BLOB_BASE}/${profile.image}`,
        isAIAgent: true,
        aiAgentType: AI_AGENT_CONFIG[email].agentType,
        isActive: true,
      }

      const agent = await prisma.user.upsert({
        where: { email },
        update: fields,
        create: { email, ...fields },
      })

      agents.push(agent)
      console.log(`✅ ${profile.name}:`, agent.name, '(' + agent.email + ')')
    }

    // Create MCP tokens for each agent
    for (const agent of agents) {
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
    for (const agent of agents) {
      console.log(`  - ${agent.name}: ${agent.email}`)
    }
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
