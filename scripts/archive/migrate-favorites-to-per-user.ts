/**
 * Data migration: Move existing isFavorite/favoriteOrder from TaskList to UserListFavorite.
 *
 * For each TaskList where isFavorite=true, creates a UserListFavorite row for the list owner.
 * Idempotent — safe to run multiple times (uses upsert).
 *
 * Usage:
 *   npx tsx scripts/migrate-favorites-to-per-user.ts
 */

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🔄 Migrating favorites from TaskList to per-user UserListFavorite...')

  const favoritedLists = await prisma.taskList.findMany({
    where: { isFavorite: true },
    select: { id: true, ownerId: true, favoriteOrder: true, name: true },
  })

  console.log(`Found ${favoritedLists.length} lists with isFavorite=true`)

  let migrated = 0
  let skipped = 0

  for (const list of favoritedLists) {
    try {
      await prisma.userListFavorite.upsert({
        where: { userId_listId: { userId: list.ownerId, listId: list.id } },
        create: {
          userId: list.ownerId,
          listId: list.id,
          favoriteOrder: list.favoriteOrder ?? 0,
        },
        update: {}, // Don't overwrite if already exists
      })
      migrated++
      console.log(`  ✅ "${list.name}" → owner ${list.ownerId} (order: ${list.favoriteOrder ?? 0})`)
    } catch (error) {
      skipped++
      console.log(`  ⚠️  Skipped "${list.name}": ${error instanceof Error ? error.message : 'unknown error'}`)
    }
  }

  console.log(`\n✅ Migration complete: ${migrated} migrated, ${skipped} skipped`)
  console.log('Note: Old isFavorite/favoriteOrder columns on TaskList can be removed in a future migration.')
}

main()
  .catch((e) => {
    console.error('❌ Migration failed:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
