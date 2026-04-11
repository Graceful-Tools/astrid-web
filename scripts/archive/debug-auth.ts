import { prisma } from "../lib/prisma"

async function debugAuth() {
  try {
    console.log("🔍 Debug Auth Issues")
    console.log("==================")
    
    // Check database connection
    console.log("1. Testing database connection...")
    await prisma.$connect()
    console.log("✅ Database connected successfully")
    
    // Check existing users
    console.log("\n2. Checking existing users...")
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        emailVerified: true,
        createdAt: true,
        password: true, // Will show if password auth is available
      },
      orderBy: {
        createdAt: 'desc'
      }
    })
    
    console.log(`Found ${users.length} users:`)
    users.forEach((user, index) => {
      console.log(`  ${index + 1}. ${user.email}`)
      console.log(`     ID: ${user.id}`)
      console.log(`     Name: ${user.name || 'Not set'}`)
      console.log(`     Email Verified: ${user.emailVerified ? '✅ Yes' : '❌ No'}`)
      console.log(`     Has Password: ${user.password ? '✅ Yes' : '❌ No (OAuth only)'}`)
      console.log(`     Created: ${user.createdAt.toISOString()}`)
      console.log("")
    })
    
    // Check accounts (OAuth providers)
    console.log("3. Checking OAuth accounts...")
    const accounts = await prisma.account.findMany({
      select: {
        userId: true,
        type: true,
        provider: true,
        providerAccountId: true,
        user: {
          select: {
            email: true
          }
        }
      }
    })
    
    console.log(`Found ${accounts.length} OAuth accounts:`)
    accounts.forEach((account, index) => {
      console.log(`  ${index + 1}. ${account.user.email} via ${account.provider}`)
    })
    
    // Check pending invitations
    console.log("\n4. Checking pending invitations...")
    const invitations = await prisma.invitation.findMany({
      where: {
        status: 'PENDING'
      },
      select: {
        email: true,
        type: true,
        role: true,
        createdAt: true,
        expiresAt: true
      }
    })
    
    console.log(`Found ${invitations.length} pending invitations:`)
    invitations.forEach((inv, index) => {
      const isExpired = inv.expiresAt < new Date()
      console.log(`  ${index + 1}. ${inv.email} (${inv.type}) ${isExpired ? '⚠️ EXPIRED' : '✅ Active'}`)
    })
    
    console.log("\n✅ Debug complete!")
    
  } catch (error) {
    console.error("❌ Error during debug:", error)
  } finally {
    await prisma.$disconnect()
  }
}

debugAuth().catch(console.error)