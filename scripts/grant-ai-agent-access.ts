#!/usr/bin/env npx tsx

/**
 * Grant AI agent access to existing lists on astrid.cc
 * This script helps make lists accessible to the AI agent
 */

import { PrismaClient } from '@prisma/client'
import { loadScriptEnv } from './lib/load-env'

loadScriptEnv()

async function grantAIAgentAccess() {
  console.log('🤖 Granting AI agent access to existing lists...\n')

  const databaseUrl = process.env.DATABASE_URL_PROD
  if (!databaseUrl) {
    console.error('❌ DATABASE_URL_PROD not found')
    return
  }

  const prisma = new PrismaClient()

  try {
    await prisma.$connect()
    console.log('✅ Connected to production database')

    // Get AI agent user
    const aiAgent = await prisma.user.findUnique({
      where: { id: 'ai-agent-claude' }
    })

    if (!aiAgent) {
      console.error('❌ AI agent not found. Run setup script first.')
      return
    }

    console.log('🤖 Found AI agent:', aiAgent.name)

    // Get all existing lists
    const allLists = await prisma.taskList.findMany({
      include: {
        owner: { select: { name: true, email: true } },
        _count: { select: { tasks: true } }
      },
      orderBy: { createdAt: 'desc' }
    })

    console.log(`\n📂 Found ${allLists.length} total lists on astrid.cc:\n`)

    allLists.forEach((list, index) => {
      console.log(`${index + 1}. 📝 ${list.name}`)
      console.log(`   ID: ${list.id}`)
      console.log(`   Owner: ${list.owner.name} (${list.owner.email})`)
      console.log(`   Tasks: ${list._count.tasks}`)
      console.log(`   Privacy: ${list.privacy}`)
      console.log(`   Created: ${new Date(list.createdAt).toLocaleDateString()}`)
      console.log('')
    })

    // Check which lists already have AI agent access
    const listsWithAIAccess = await prisma.taskList.findMany({
      where: {
        OR: [
          { ownerId: aiAgent.id },
          { listMembers: { some: { userId: aiAgent.id } } }
        ]
      }
    })

    console.log(`🤖 AI agent currently has access to ${listsWithAIAccess.length} lists`)

    if (allLists.length > 0) {
      console.log('\n🔧 To grant AI agent access to all lists, I can:')
      console.log('1. Add AI agent as a member to all lists')
      console.log('2. Add AI agent as admin to specific lists')
      console.log('3. Transfer ownership of specific lists to AI agent')
      console.log('\nWould you like me to add the AI agent as a member to all lists?')
    }

    return allLists

  } catch (error) {
    console.error('❌ Error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

async function addAIAgentToAllLists() {
  console.log('🔧 Adding AI agent as member to all lists...\n')

  const databaseUrl = process.env.DATABASE_URL_PROD
  const prisma = new PrismaClient()

  try {
    await prisma.$connect()

    // Get AI agent
    const aiAgent = await prisma.user.findUnique({
      where: { id: 'ai-agent-claude' }
    })

    if (!aiAgent) {
      console.error('❌ AI agent not found')
      return
    }

    // Get all lists
    const allLists = await prisma.taskList.findMany()

    console.log(`📝 Adding AI agent to ${allLists.length} lists...`)

    for (const list of allLists) {
      try {
        // Add AI agent as list member with admin role
        await prisma.listMember.upsert({
          where: {
            listId_userId: {
              listId: list.id,
              userId: aiAgent.id
            }
          },
          update: {
            role: 'admin'
          },
          create: {
            listId: list.id,
            userId: aiAgent.id,
            role: 'admin'
          }
        })

        console.log(`✅ Added AI agent to: ${list.name}`)
      } catch (error) {
        console.log(`⚠️ Could not add AI agent to ${list.name}:`, error)
      }
    }

    console.log('\n🎉 AI agent access granted to all lists!')

  } catch (error) {
    console.error('❌ Error:', error)
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  grantAIAgentAccess().catch(console.error)
}

export { grantAIAgentAccess, addAIAgentToAllLists }