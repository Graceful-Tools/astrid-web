import { getUserStats } from "@/lib/user-stats"

async function testStats() {
  try {
    const userId = "cmhzkytol0000wzppafk1ubm9"
    console.log("Testing stats for user:", userId)

    const stats = await getUserStats(userId)
    console.log("✅ Stats retrieved:", stats)
  } catch (error) {
    console.error("❌ Error:", error)
  }
}

testStats()
