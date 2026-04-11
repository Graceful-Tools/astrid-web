import bcrypt from "bcryptjs"
import { prisma } from "../lib/prisma"

async function testCredentials() {
  try {
    console.log("🔐 Testing Credentials Authentication")
    console.log("==================================")
    
    const testEmail = "pm@kuoparis.com"
    const testPassword = "test1234"
    
    console.log(`Testing login for: ${testEmail}`)
    
    // Check if user exists and get password
    const user = await prisma.user.findUnique({
      where: { email: testEmail.toLowerCase() },
      select: {
        id: true,
        email: true,
        name: true,
        password: true,
        emailVerified: true
      }
    })
    
    if (!user) {
      console.log("❌ User not found")
      return
    }
    
    console.log("✅ User found:", {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: user.emailVerified,
      hasPassword: !!user.password
    })
    
    if (!user.password) {
      console.log("❌ User has no password set")
      return
    }
    
    // Test password
    const isPasswordValid = await bcrypt.compare(testPassword, user.password)
    console.log(`Password validation: ${isPasswordValid ? '✅ VALID' : '❌ INVALID'}`)
    
    if (isPasswordValid) {
      console.log("🎉 Credentials authentication should work!")
      console.log("User can sign in with:")
      console.log(`  Email: ${testEmail}`)
      console.log(`  Password: ${testPassword}`)
    }
    
  } catch (error) {
    console.error("❌ Error during test:", error)
  } finally {
    await prisma.$disconnect()
  }
}

testCredentials().catch(console.error)