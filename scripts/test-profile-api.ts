import { createScriptPrisma } from "./lib/script-prisma"

const prisma = createScriptPrisma()

async function testProfileAPI() {
  try {
    // Get a user from the database
    const user = await prisma.user.findFirst({
      where: {
        isActive: true,
        isAIAgent: false,
      },
      select: {
        id: true,
        name: true,
        email: true,
      },
    })

    if (!user) {
      console.log("❌ No users found in database")
      return
    }

    console.log("✅ Found user:", user)
    console.log("\n📍 You can access this user's profile at:")
    console.log(`   http://localhost:3000/u/${user.id}`)
    console.log(`   http://192.168.50.161:3000/u/${user.id}`)

    console.log("\n⚠️  Make sure you're logged in first!")
  } catch (error) {
    console.error("❌ Error:", error)
  } finally {
    await prisma.$disconnect()
  }
}

testProfileAPI()
