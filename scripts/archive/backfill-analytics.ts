/**
 * Backfill Analytics Script
 *
 * This script reconstructs analytics events from existing database records
 * and populates AnalyticsDailyStats for historical data.
 *
 * Run: npx tsx scripts/backfill-analytics.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const PLATFORM_UNKNOWN = 'unknown'

interface EventRecord {
  userId: string
  eventType: string
  platform: string
  createdAt: Date
}

async function backfillAnalytics() {
  console.log('🔄 Starting analytics backfill...\n')

  // 1. Collect all events from existing data
  const events: EventRecord[] = []

  // Tasks - created
  console.log('📋 Collecting task creation events...')
  const tasks = await prisma.task.findMany({
    where: {
      creatorId: { not: null },
    },
    select: {
      id: true,
      creatorId: true,
      createdAt: true,
      completed: true,
      updatedAt: true,
    },
  })

  for (const task of tasks) {
    if (task.creatorId) {
      events.push({
        userId: task.creatorId,
        eventType: 'task_created',
        platform: PLATFORM_UNKNOWN,
        createdAt: task.createdAt,
      })

      // If task is completed, add a completion event (approximate time with updatedAt)
      if (task.completed) {
        events.push({
          userId: task.creatorId,
          eventType: 'task_completed',
          platform: PLATFORM_UNKNOWN,
          createdAt: task.updatedAt,
        })
      }
    }
  }
  console.log(`   Found ${tasks.length} tasks`)

  // Comments - created
  console.log('💬 Collecting comment events...')
  const comments = await prisma.comment.findMany({
    where: {
      authorId: { not: null },
    },
    select: {
      id: true,
      authorId: true,
      createdAt: true,
    },
  })

  for (const comment of comments) {
    if (comment.authorId) {
      events.push({
        userId: comment.authorId,
        eventType: 'comment_added',
        platform: PLATFORM_UNKNOWN,
        createdAt: comment.createdAt,
      })
    }
  }
  console.log(`   Found ${comments.length} comments`)

  // Lists - created
  console.log('📁 Collecting list events...')
  const lists = await prisma.taskList.findMany({
    select: {
      id: true,
      ownerId: true,
      createdAt: true,
    },
  })

  for (const list of lists) {
    events.push({
      userId: list.ownerId,
      eventType: 'list_added',
      platform: PLATFORM_UNKNOWN,
      createdAt: list.createdAt,
    })
  }
  console.log(`   Found ${lists.length} lists`)

  // 2. Insert events into AnalyticsEvent table
  console.log(`\n📊 Inserting ${events.length} events into AnalyticsEvent table...`)

  // Batch insert for performance
  const batchSize = 1000
  let inserted = 0

  for (let i = 0; i < events.length; i += batchSize) {
    const batch = events.slice(i, i + batchSize)
    await prisma.analyticsEvent.createMany({
      data: batch.map((e) => ({
        userId: e.userId,
        eventType: e.eventType,
        platform: e.platform,
        createdAt: e.createdAt,
      })),
      skipDuplicates: true,
    })
    inserted += batch.length
    process.stdout.write(`\r   Inserted ${inserted}/${events.length} events`)
  }
  console.log('\n')

  // 3. Aggregate daily stats
  console.log('📈 Aggregating daily stats...')

  // Find date range from events
  const dateRange = await prisma.analyticsEvent.aggregate({
    _min: { createdAt: true },
    _max: { createdAt: true },
  })

  if (!dateRange._min.createdAt || !dateRange._max.createdAt) {
    console.log('   No events found to aggregate')
    return
  }

  const startDate = new Date(dateRange._min.createdAt)
  startDate.setUTCHours(0, 0, 0, 0)

  const endDate = new Date(dateRange._max.createdAt)
  endDate.setUTCHours(0, 0, 0, 0)

  // Import aggregation function
  const { aggregateDailyStats } = await import('../lib/analytics-events')

  // Iterate through each day
  let currentDate = new Date(startDate)
  let daysProcessed = 0
  const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)) + 1

  while (currentDate <= endDate) {
    await aggregateDailyStats(currentDate)
    daysProcessed++
    process.stdout.write(`\r   Processed ${daysProcessed}/${totalDays} days`)
    currentDate.setUTCDate(currentDate.getUTCDate() + 1)
  }
  console.log('\n')

  // 4. Ensure initial admin exists
  console.log('👤 Ensuring initial admin exists...')
  const { ensureInitialAdmin } = await import('../lib/admin-auth')
  await ensureInitialAdmin()

  console.log('\n✅ Analytics backfill complete!')

  // Show summary
  const eventCount = await prisma.analyticsEvent.count()
  const statsCount = await prisma.analyticsDailyStats.count()
  const adminCount = await prisma.adminUser.count()

  console.log('\n📊 Summary:')
  console.log(`   Analytics Events: ${eventCount}`)
  console.log(`   Daily Stats Records: ${statsCount}`)
  console.log(`   Admin Users: ${adminCount}`)
}

// Run the backfill
backfillAnalytics()
  .catch((error) => {
    console.error('❌ Backfill failed:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
