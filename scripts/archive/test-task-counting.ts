#!/usr/bin/env npx tsx

/**
 * Test task counting logic directly
 */

import dotenv from 'dotenv'
import path from 'path'

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function testTaskCounting() {
  console.log('🧪 Testing task counting logic...\n')

  const { getListTaskCount, getMultipleListTaskCounts } = await import('../lib/task-count-utils')
  const { prisma } = await import('../lib/prisma')

  try {
    // First, let's find some public lists to test with
    console.log('🔍 Finding public lists...')
    const publicLists = await prisma.taskList.findMany({
      where: {
        privacy: 'PUBLIC'
      },
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            tasks: true // This is the raw count without filtering
          }
        }
      },
      take: 3
    })

    console.log(`Found ${publicLists.length} public lists:`)
    publicLists.forEach(list => {
      console.log(`- ${list.name} (${list.id}): Raw task count = ${list._count.tasks}`)
    })

    if (publicLists.length === 0) {
      console.log('❌ No public lists found to test with')
      return
    }

    console.log('\n🔧 Testing individual task counting...')

    for (const list of publicLists) {
      console.log(`\n📋 Testing list: ${list.name}`)

      // Test different counting scenarios
      const scenarios = [
        {
          name: 'All tasks (current production logic)',
          options: { includePrivate: false, isPublicContext: true }
        },
        {
          name: 'Only incomplete tasks',
          options: { includePrivate: false, isPublicContext: true, includeCompleted: false }
        },
        {
          name: 'All tasks including private',
          options: { includePrivate: true, isPublicContext: false }
        }
      ]

      for (const scenario of scenarios) {
        const count = await getListTaskCount(list.id, scenario.options)
        console.log(`  ${scenario.name}: ${count} tasks`)
      }

      // Also check what tasks actually exist in this list
      console.log('  📝 Actual tasks in this list:')
      const tasks = await prisma.task.findMany({
        where: {
          lists: {
            some: {
              id: list.id
            }
          }
        },
        select: {
          id: true,
          title: true,
          completed: true,
          isPrivate: true,
          assigneeId: true
        }
      })

      console.log(`    Total tasks found: ${tasks.length}`)
      console.log(`    Completed: ${tasks.filter(t => t.completed).length}`)
      console.log(`    Private: ${tasks.filter(t => t.isPrivate).length}`)
      console.log(`    Unassigned: ${tasks.filter(t => !t.assigneeId).length}`)
      console.log(`    Assigned: ${tasks.filter(t => t.assigneeId).length}`)
    }

    console.log('\n🔧 Testing batch counting...')
    const listIds = publicLists.map(l => l.id)
    const batchCounts = await getMultipleListTaskCounts(listIds, {
      includePrivate: false,
      isPublicContext: true
    })

    console.log('Batch counts:')
    publicLists.forEach(list => {
      console.log(`- ${list.name}: ${batchCounts[list.id] || 0} tasks`)
    })

  } catch (error) {
    console.error('❌ Error testing task counting:', error)
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  testTaskCounting().catch(console.error)
}

export { testTaskCounting }