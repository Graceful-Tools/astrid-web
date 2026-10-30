#!/usr/bin/env node

/**
 * Data Migration: Assign Default Images to Lists Without Images
 *
 * This migration safely updates existing lists that don't have imageUrl set
 * to use a consistent default image based on their ID hash.
 *
 * SAFE OPERATION: Only updates NULL or empty imageUrl fields, never overwrites existing images.
 */

const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

// Simple hash function to convert string to number
function simpleHash(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32-bit integer
  }
  return Math.abs(hash)
}

// Default list images (matching the TypeScript version)
const DEFAULT_LIST_IMAGES = [
  {
    name: "Default List 0",
    filename: "/icons/default_list_0.png",
    theme: "default",
    color: "#3b82f6",
    description: "Default list icon"
  },
  {
    name: "Default List 1",
    filename: "/icons/default_list_1.png",
    theme: "default",
    color: "#10b981",
    description: "Default list icon"
  },
  {
    name: "Default List 2",
    filename: "/icons/default_list_2.png",
    theme: "default",
    color: "#f59e0b",
    description: "Default list icon"
  },
  {
    name: "Default List 3",
    filename: "/icons/default_list_3.png",
    theme: "default",
    color: "#8b5cf6",
    description: "Default list icon"
  }
]

// Get a consistent default image for a list based on its ID
function getConsistentDefaultImage(listId) {
  const hash = simpleHash(listId)
  const index = hash % DEFAULT_LIST_IMAGES.length
  return DEFAULT_LIST_IMAGES[index]
}

async function migrateListImages() {
  console.log('🔄 Starting migration: Assign default images to lists without images')
  console.log('📅 Date:', new Date().toISOString())

  try {
    // Find all lists without imageUrl or with null/empty imageUrl
    // SAFE: Only selects lists that need updates
    const listsWithoutImages = await prisma.taskList.findMany({
      where: {
        OR: [
          { imageUrl: null },
          { imageUrl: '' },
          { imageUrl: { equals: null } }
        ]
      },
      select: {
        id: true,
        name: true,
        imageUrl: true,
        ownerId: true
      }
    })

    console.log(`📋 Found ${listsWithoutImages.length} lists without images`)

    if (listsWithoutImages.length === 0) {
      console.log('✅ Migration complete: All lists already have images assigned!')
      return { updated: 0, skipped: 0, errors: 0 }
    }

    let updatedCount = 0
    let errorCount = 0

    console.log('\n🖼️ Updating lists with consistent default images...')

    for (const list of listsWithoutImages) {
      const consistentImage = getConsistentDefaultImage(list.id)

      try {
        // SAFE: Only update lists that don't have images
        const result = await prisma.taskList.updateMany({
          where: {
            id: list.id,
            OR: [
              { imageUrl: null },
              { imageUrl: '' },
              { imageUrl: { equals: null } }
            ]
          },
          data: {
            imageUrl: consistentImage.filename
          }
        })

        if (result.count > 0) {
          console.log(`✅ Updated "${list.name}" (${list.id}) → ${consistentImage.filename}`)
          updatedCount++
        } else {
          console.log(`⏭️  Skipped "${list.name}" (already has image)`)
        }
      } catch (error) {
        console.error(`❌ Failed to update "${list.name}" (${list.id}):`, error.message)
        errorCount++
      }
    }

    console.log('\n📊 Migration Summary:')
    console.log(`   ✅ Successfully updated: ${updatedCount} lists`)
    console.log(`   ❌ Errors: ${errorCount} lists`)
    console.log(`   📁 Total processed: ${listsWithoutImages.length} lists`)

    if (errorCount === 0) {
      console.log('\n🎉 Migration completed successfully!')
    } else {
      console.log('\n⚠️  Migration completed with some errors')
    }

    return { updated: updatedCount, skipped: listsWithoutImages.length - updatedCount - errorCount, errors: errorCount }

  } catch (error) {
    console.error('💥 Migration failed:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

// Run the migration if called directly
if (require.main === module) {
  migrateListImages().catch(error => {
    console.error('Migration script failed:', error)
    process.exit(1)
  })
}

module.exports = { migrateListImages }