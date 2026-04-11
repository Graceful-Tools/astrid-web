#!/usr/bin/env tsx

import { prisma } from '../lib/prisma'
import { getRandomDefaultImage } from '../lib/default-images'

async function assignDefaultListImages() {
  console.log('🎨 Starting list image assignment...')

  try {
    // Find all lists that need default images assigned
    const listsNeedingImages = await prisma.taskList.findMany({
      where: {
        OR: [
          { imageUrl: null },
          { imageUrl: '' },
          // Also handle lists that might have placeholder or broken image URLs
          { imageUrl: { startsWith: 'https://picsum.photos' } },
          { imageUrl: { startsWith: 'https://via.placeholder.com' } }
        ]
      }
    })

    console.log(`📊 Found ${listsNeedingImages.length} lists needing image assignment`)

    if (listsNeedingImages.length === 0) {
      console.log('✅ All lists already have proper images assigned')
      return
    }

    // Assign random default images to each list
    const updatePromises = listsNeedingImages.map(async (list) => {
      const randomImage = getRandomDefaultImage()
      console.log(`🔄 Assigning "${randomImage.name}" to list "${list.name}" (${list.id})`)

      return prisma.taskList.update({
        where: { id: list.id },
        data: { imageUrl: randomImage.filename }
      })
    })

    // Execute all updates
    await Promise.all(updatePromises)

    console.log(`✅ Successfully assigned default images to ${listsNeedingImages.length} lists`)

    // Show summary of assignments
    const summary = await prisma.taskList.groupBy({
      by: ['imageUrl'],
      where: {
        imageUrl: {
          in: [
            '/icons/default_list_0.png',
            '/icons/default_list_1.png',
            '/icons/default_list_2.png',
            '/icons/default_list_3.png'
          ]
        }
      },
      _count: {
        imageUrl: true
      }
    })

    console.log('\n📈 Default image distribution:')
    summary.forEach(({ imageUrl, _count }) => {
      const imageName = imageUrl?.split('/').pop()?.replace('.png', '') || 'unknown'
      console.log(`  ${imageName}: ${_count.imageUrl} lists`)
    })

  } catch (error) {
    console.error('❌ Error assigning default list images:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

// Run the script
if (require.main === module) {
  assignDefaultListImages()
    .then(() => {
      console.log('\n🎉 List image assignment completed successfully!')
      process.exit(0)
    })
    .catch((error) => {
      console.error('\n💥 Script failed:', error)
      process.exit(1)
    })
}

export { assignDefaultListImages }