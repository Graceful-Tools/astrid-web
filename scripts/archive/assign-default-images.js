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

async function assignDefaultImages() {
  try {
    console.log('🖼️ Starting to assign default images to lists...')

    // Find all lists without imageUrl or with null/empty imageUrl
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
        imageUrl: true
      }
    })

    console.log(`📋 Found ${listsWithoutImages.length} lists without images`)

    if (listsWithoutImages.length === 0) {
      console.log('✅ All lists already have images assigned!')
      return
    }

    let updatedCount = 0

    for (const list of listsWithoutImages) {
      const consistentImage = getConsistentDefaultImage(list.id)

      try {
        await prisma.taskList.update({
          where: { id: list.id },
          data: { imageUrl: consistentImage.filename }
        })

        console.log(`✅ Updated list "${list.name}" (${list.id}) with image: ${consistentImage.filename}`)
        updatedCount++
      } catch (error) {
        console.error(`❌ Failed to update list "${list.name}" (${list.id}):`, error.message)
      }
    }

    console.log(`🎉 Successfully assigned default images to ${updatedCount} lists!`)

  } catch (error) {
    console.error('💥 Error assigning default images:', error)
  } finally {
    await prisma.$disconnect()
  }
}

// Run the script if called directly
if (require.main === module) {
  assignDefaultImages()
}

module.exports = { assignDefaultImages }