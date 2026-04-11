#!/usr/bin/env tsx

/**
 * Update list ownership to a specific user
 * Usage: DATABASE_URL="<prod-url>" npx tsx scripts/update-list-owner.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function updateListOwner() {
  try {
    // List IDs to update
    const listIds = [
      '83577486-0035-4d30-844a-9a12403d8d25',
      'd49e99e7-16af-4dfd-ae52-db9d4951fe5d'
    ]

    // Find the user
    const user = await prisma.user.findUnique({
      where: { email: 'jon@gracefultools.com' }
    })

    if (!user) {
      console.error('❌ User not found: jon@gracefultools.com')
      process.exit(1)
    }

    console.log(`✅ Found user: ${user.name} (${user.email}) - ID: ${user.id}`)

    // Update each list
    for (const listId of listIds) {
      // First, check if the list exists
      const list = await prisma.taskList.findUnique({
        where: { id: listId },
        include: {
          owner: true
        }
      })

      if (!list) {
        console.error(`❌ List not found: ${listId}`)
        continue
      }

      console.log(`\n📋 Updating list: ${list.name}`)
      console.log(`   Current owner: ${list.owner?.name} (${list.owner?.email})`)

      // Update the owner
      const updated = await prisma.taskList.update({
        where: { id: listId },
        data: { ownerId: user.id },
        include: {
          owner: true
        }
      })

      console.log(`   ✅ New owner: ${updated.owner.name} (${updated.owner.email})`)
    }

    console.log('\n✅ All lists updated successfully!')
  } catch (error) {
    console.error('❌ Error updating lists:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

updateListOwner()
