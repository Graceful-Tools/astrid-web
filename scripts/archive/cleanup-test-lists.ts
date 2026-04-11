#!/usr/bin/env tsx
/**
 * Clean up test lists created by iOS unit tests
 * Run this to remove test data from production accounts
 *
 * Usage: npx tsx scripts/cleanup-test-lists.ts <email>
 * Example: npx tsx scripts/cleanup-test-lists.ts wonk1@kuoparis.com
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function cleanupTestLists(userEmail: string) {
  console.log(`🧹 Cleaning up test lists for ${userEmail}...`)

  // Find the user
  const user = await prisma.user.findUnique({
    where: { email: userEmail },
    include: {
      ownedLists: {
        where: {
          OR: [
            { name: { startsWith: 'Test List' } },
            { name: { startsWith: 'Public List' } },
            { name: { startsWith: 'Updated List Name' } },
            { name: { startsWith: 'New Name' } },
            { description: { contains: 'Test list for' } },
            { description: { contains: 'test list description' } }
          ]
        }
      }
    }
  })

  if (!user) {
    console.error(`❌ User ${userEmail} not found`)
    process.exit(1)
  }

  const testLists = user.ownedLists
  console.log(`📋 Found ${testLists.length} test lists`)

  if (testLists.length === 0) {
    console.log('✅ No test lists to clean up')
    return
  }

  // Show what we found
  console.log('\n Test lists to delete:')
  testLists.forEach((list, i) => {
    console.log(`  ${i + 1}. ${list.name} (${list.id})`)
  })

  // Confirm deletion
  console.log(`\n⚠️  About to delete ${testLists.length} test lists`)
  console.log('   Press Ctrl+C to cancel, or wait 5 seconds to proceed...')
  await new Promise(resolve => setTimeout(resolve, 5000))

  // Delete all test lists
  let deleted = 0
  for (const list of testLists) {
    try {
      // Delete the list (cascade will handle tasks relationship)
      await prisma.taskList.delete({
        where: { id: list.id }
      })

      deleted++
      console.log(`  ✅ Deleted: ${list.name}`)
    } catch (error) {
      console.error(`  ❌ Failed to delete ${list.name}:`, error)
    }
  }

  console.log(`\n✅ Cleanup complete! Deleted ${deleted}/${testLists.length} test lists`)
}

// Main
const userEmail = process.argv[2]
if (!userEmail) {
  console.error('❌ Please provide user email')
  console.error('Usage: npx tsx scripts/cleanup-test-lists.ts <email>')
  process.exit(1)
}

cleanupTestLists(userEmail)
  .catch(error => {
    console.error('❌ Error:', error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
