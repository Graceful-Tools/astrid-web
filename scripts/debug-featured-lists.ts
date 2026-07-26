#!/usr/bin/env npx tsx

/**
 * Debug script to check the actual API response for featured lists
 */

import { loadScriptEnv } from './lib/load-env'

loadScriptEnv()

async function debugFeaturedLists() {
  console.log('🔍 Debugging featured lists API response...\n')

  try {
    // Test the actual API endpoint that the frontend calls
    const response = await fetch('http://localhost:3000/api/lists/public?limit=3', {
      headers: {
        'Content-Type': 'application/json',
        // We need to simulate a proper session, but for debugging let's see the raw response
      }
    })

    if (!response.ok) {
      console.log('❌ API Response failed:', response.status, response.statusText)
      const errorText = await response.text()
      console.log('Error details:', errorText)
      return
    }

    const data = await response.json()
    console.log('📋 API Response structure:')
    console.log(JSON.stringify(data, null, 2))

    if (data.lists && data.lists.length > 0) {
      console.log('\n🔍 Analyzing first list structure:')
      const firstList = data.lists[0]
      console.log('List ID:', firstList.id)
      console.log('List Name:', firstList.name)
      console.log('Has _count?', !!firstList._count)
      console.log('_count structure:', firstList._count)
      console.log('_count.tasks:', firstList._count?.tasks)
      console.log('Type of _count.tasks:', typeof firstList._count?.tasks)

      // Test the type assertion pattern from the component
      const displayCount = (firstList as any)._count?.tasks || 0
      console.log('Display count (with type assertion):', displayCount)
    }

  } catch (error) {
    console.error('❌ Error fetching featured lists:', error)
  }
}

if (require.main === module) {
  debugFeaturedLists().catch(console.error)
}

export { debugFeaturedLists }