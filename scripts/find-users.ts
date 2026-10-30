/**
 * Find Users Script
 * List all users in the database
 */

import { createScriptPrisma } from './lib/script-prisma'

async function main() {
  const prisma = createScriptPrisma()

  try {
    console.log('👥 Finding all users in database...\n')

    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        isAIAgent: true,
        createdAt: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    })

    if (users.length === 0) {
      console.log('❌ No users found in database')
    } else {
      console.log(`📊 Found ${users.length} users:`)
      console.log(''.padEnd(80, '='))

      users.forEach((user, index) => {
        console.log(`${index + 1}. ${user.email}`)
        console.log(`   Name: ${user.name || 'Not set'}`)
        console.log(`   ID: ${user.id}`)
        console.log(`   AI Agent: ${user.isAIAgent ? 'Yes' : 'No'}`)
        console.log(`   Created: ${user.createdAt.toISOString()}`)
        console.log('')
      })

      console.log(''.padEnd(80, '='))
      console.log(`\n🔍 To test API keys for a user, run:`)
      console.log(`npx tsx scripts/test-api-keys.ts [email]`)
      console.log(`\nExample:`)
      console.log(`npx tsx scripts/test-api-keys.ts ${users.find(u => !u.isAIAgent)?.email || users[0].email}`)
    }

  } catch (error) {
    console.error('❌ Error finding users:', error)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(console.error)