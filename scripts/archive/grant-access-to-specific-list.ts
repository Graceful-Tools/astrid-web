#!/usr/bin/env npx tsx

/**
 * Grant AI agent access to a specific list
 */

import dotenv from 'dotenv'
import path from 'path'
import { PrismaClient } from '@prisma/client'

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function grantAccessToList(listId: string, listName: string) {
  console.log(`🔧 Granting AI agent access to "${listName}"...\n`)

  const databaseUrl = process.env.DATABASE_URL_PROD
  const prisma = new PrismaClient({
  })

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

    console.log('🤖 Found AI agent:', aiAgent.name)

    // Add AI agent as list member with admin role
    const listMember = await prisma.listMember.upsert({
      where: {
        listId_userId: {
          listId: listId,
          userId: aiAgent.id
        }
      },
      update: {
        role: 'admin'
      },
      create: {
        listId: listId,
        userId: aiAgent.id,
        role: 'admin'
      }
    })

    console.log(`✅ AI agent granted admin access to "${listName}"`)
    console.log(`📋 List Member ID: ${listMember.id}`)

    return true

  } catch (error) {
    console.error('❌ Error granting access:', error)
    return false
  } finally {
    await prisma.$disconnect()
  }
}

async function main() {
  // Astrid Bugs & Polish list ID
  const listId = 'a623f322-4c3c-49b5-8a94-d2d9f00c82ba'
  const listName = 'Astrid Bugs & Polish'

  await grantAccessToList(listId, listName)
}

if (require.main === module) {
  main().catch(console.error)
}

export { grantAccessToList }