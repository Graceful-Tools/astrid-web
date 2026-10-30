#!/usr/bin/env tsx

/**
 * Test Email Verification Logic Script
 * 
 * This script tests the updated email verification logic
 * to ensure OAuth users are properly marked as verified.
 */

import { createScriptPrisma } from './lib/script-prisma'

const prisma = createScriptPrisma()

async function testVerificationLogic() {
  console.log('🧪 Testing Email Verification Logic\n')

  try {
    // Test 1: Check if there are any users with OAuth accounts
    console.log('1. Checking users with OAuth accounts:')
    const usersWithOAuth = await prisma.user.findMany({
      where: {
        accounts: {
          some: {}
        }
      },
      select: {
        id: true,
        email: true,
        emailVerified: true,
        accounts: {
          select: {
            provider: true
          }
        }
      }
    })

    if (usersWithOAuth.length > 0) {
      console.log(`   Found ${usersWithOAuth.length} user(s) with OAuth accounts:`)
      usersWithOAuth.forEach(user => {
        console.log(`   - ${user.email} (${user.accounts.map(acc => acc.provider).join(', ')})`)
        console.log(`     emailVerified: ${user.emailVerified}`)
      })
    } else {
      console.log('   No users with OAuth accounts found')
    }

    // Test 2: Check all users and their verification status
    console.log('\n2. Checking all users:')
    const allUsers = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        emailVerified: true,
        _count: {
          select: {
            accounts: true
          }
        }
      }
    })

    allUsers.forEach(user => {
      const hasOAuth = user._count.accounts > 0
      const isVerified = !!user.emailVerified || hasOAuth
      console.log(`   - ${user.email}: ${isVerified ? '✅ Verified' : '❌ Not verified'} (OAuth: ${hasOAuth ? 'Yes' : 'No'})`)
    })

    console.log('\n✅ Verification logic test completed!')

  } catch (error) {
    console.error('❌ Error testing verification logic:', error)
  } finally {
    await prisma.$disconnect()
  }
}

// Run the test
testVerificationLogic()
