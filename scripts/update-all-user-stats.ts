#!/usr/bin/env node
/**
 * Update statistics for all users
 * This script recalculates and updates cached statistics for all active users
 */

import { createScriptPrisma } from "./lib/script-prisma"
import { updateUserStats } from "../lib/user-stats"

const prisma = createScriptPrisma()

async function updateAllUserStats() {
  try {
    console.log("🔄 Starting user statistics update...\n")

    // Get all active users
    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        isAIAgent: false, // Skip AI agents
      },
      select: {
        id: true,
        name: true,
        email: true,
      },
    })

    console.log(`📊 Found ${users.length} users to update\n`)

    let successCount = 0
    let errorCount = 0

    // Update stats for each user
    for (const user of users) {
      try {
        console.log(`📝 Updating stats for: ${user.name || user.email}`)
        const stats = await updateUserStats(user.id)
        console.log(`   ✅ Completed: ${stats.completedTasks}, Inspired: ${stats.inspiredTasks}, Supported: ${stats.supportedTasks}`)
        successCount++
      } catch (error) {
        console.error(`   ❌ Error updating user ${user.email}:`, error)
        errorCount++
      }
    }

    console.log("\n" + "=".repeat(50))
    console.log(`✅ Successfully updated: ${successCount} users`)
    if (errorCount > 0) {
      console.log(`❌ Errors: ${errorCount} users`)
    }
    console.log("=".repeat(50))
  } catch (error) {
    console.error("💥 Fatal error:", error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

// Run the update
updateAllUserStats()
  .then(() => {
    console.log("\n🎉 User statistics update complete!")
    process.exit(0)
  })
  .catch((error) => {
    console.error("\n💥 Update failed:", error)
    process.exit(1)
  })
