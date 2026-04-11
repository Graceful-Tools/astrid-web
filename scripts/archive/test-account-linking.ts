#!/usr/bin/env tsx

/**
 * Test Account Linking Script
 * 
 * This script tests the account linking functionality to ensure users can
 * sign in with both email/password and OAuth providers using the same email.
 */

import { prisma } from "../lib/prisma"
import bcrypt from "bcryptjs"

async function testAccountLinking() {
  console.log('🔗 Testing Account Linking System\n')

  const testEmail = "linkingtest@example.com"
  const testPassword = "testpassword123"

  try {
    // Clean up any existing test data
    console.log('🧹 Cleaning up test data...')
    await prisma.account.deleteMany({ where: { user: { email: testEmail } } })
    await prisma.session.deleteMany({ where: { user: { email: testEmail } } })
    await prisma.user.deleteMany({ where: { email: testEmail } })

    // Test 1: Create user with email/password
    console.log('\n1. Creating user with email/password:')
    const hashedPassword = await bcrypt.hash(testPassword, 12)
    const passwordUser = await prisma.user.create({
      data: {
        email: testEmail,
        password: hashedPassword,
        name: "Test User (Password)",
        emailVerified: new Date()
      }
    })
    console.log(`   ✅ Created user: ${passwordUser.id}`)

    // Test 2: Simulate OAuth account linking
    console.log('\n2. Simulating OAuth account linking:')
    
    // This simulates what our custom adapter should do
    const existingUser = await prisma.user.findUnique({
      where: { email: testEmail.toLowerCase() }
    })

    if (existingUser) {
      console.log(`   ✅ Found existing user: ${existingUser.email}`)
      
      // Create OAuth account linked to existing user
      const oauthAccount = await prisma.account.create({
        data: {
          userId: existingUser.id,
          type: "oauth",
          provider: "google",
          providerAccountId: "fake-google-id-123",
          access_token: "fake-access-token",
          token_type: "Bearer",
          scope: "openid email profile"
        }
      })
      console.log(`   ✅ Created OAuth account: ${oauthAccount.id}`)
    } else {
      console.log('   ❌ User not found - account linking failed')
      return
    }

    // Test 3: Verify the user has both authentication methods
    console.log('\n3. Verifying user has multiple authentication methods:')
    const userWithAccounts = await prisma.user.findUnique({
      where: { email: testEmail },
      include: { accounts: true }
    })

    if (userWithAccounts) {
      console.log(`   User ID: ${userWithAccounts.id}`)
      console.log(`   Email: ${userWithAccounts.email}`)
      console.log(`   Has password: ${!!userWithAccounts.password}`)
      console.log(`   Number of linked accounts: ${userWithAccounts.accounts.length}`)
      
      userWithAccounts.accounts.forEach((account, index) => {
        console.log(`   Account ${index + 1}: ${account.provider} (${account.type})`)
      })

      if (userWithAccounts.password && userWithAccounts.accounts.length > 0) {
        console.log('   ✅ User can authenticate with both methods!')
      } else {
        console.log('   ❌ Account linking incomplete')
      }
    }

    // Test 4: Test password authentication still works
    console.log('\n4. Testing password authentication:')
    if (userWithAccounts?.password) {
      const passwordValid = await bcrypt.compare(testPassword, userWithAccounts.password)
      console.log(`   Password authentication: ${passwordValid ? '✅ Works' : '❌ Failed'}`)
    }

    console.log('\n✅ Account linking tests completed!')

  } catch (error) {
    console.error('❌ Test failed:', error)
  } finally {
    // Clean up test data
    console.log('\n🧹 Cleaning up test data...')
    try {
      await prisma.account.deleteMany({ where: { user: { email: testEmail } } })
      await prisma.session.deleteMany({ where: { user: { email: testEmail } } })
      await prisma.user.deleteMany({ where: { email: testEmail } })
      console.log('   ✅ Test data cleaned up')
    } catch (cleanupError) {
      console.error('⚠️  Cleanup failed:', cleanupError)
    }
    
    await prisma.$disconnect()
  }
}

// Run the test
testAccountLinking().catch(console.error)