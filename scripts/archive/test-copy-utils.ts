#!/usr/bin/env npx tsx

/**
 * Test the actual copy-utils functions after the fix
 */

import dotenv from 'dotenv'
import path from 'path'

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function testCopyUtils() {
  console.log('🧪 Testing copy-utils functions after the fix...\n')

  const { getPopularPublicLists } = await import('../lib/copy-utils')

  try {
    console.log('🔍 Testing getPopularPublicLists...')
    const publicLists = await getPopularPublicLists(3)

    console.log(`Found ${publicLists.length} public lists:`)
    publicLists.forEach(list => {
      console.log(`- ${list.name} (${list.id}):`)
      console.log(`  _count.tasks: ${list._count?.tasks}`)
      console.log(`  Raw count: ${list._count?.tasks}`)
    })

    // Test what would be displayed in the frontend
    console.log('\n🖼️ Frontend display counts:')
    publicLists.slice(0, 3).forEach(list => {
      const displayCount = (list as any)._count?.tasks || 0
      console.log(`- ${list.name}: ${displayCount} tasks`)
    })

  } catch (error) {
    console.error('❌ Error testing copy utils:', error)
  }
}

if (require.main === module) {
  testCopyUtils().catch(console.error)
}

export { testCopyUtils }