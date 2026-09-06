/**
 * Backfill Analytics Script — DESTRUCTIVE. Prefer scripts/reaggregate-analytics.ts.
 *
 * This does NOT re-aggregate existing analytics. It SYNTHESISES AnalyticsEvent
 * rows from Task/Comment/TaskList records — every one with `platform: 'unknown'`
 * and an approximate timestamp (a task's `updatedAt` stands in for its
 * completion time) — writes them into the real event table, and then rebuilds
 * every day from the earliest event to the latest.
 *
 * Three properties make it unsafe to reach for casually (task 82752f76):
 *
 *   1. The synthetic events are indistinguishable from real ones afterwards.
 *   2. `skipDuplicates: true` below is a NO-OP: AnalyticsEvent has only plain
 *      indexes, no unique constraint, so nothing can conflict. Each run inserts
 *      another full copy of every synthetic event and inflates every day again.
 *   3. There is no window — it rewrites all of history, not the gap you meant.
 *
 * To repair missing AnalyticsDailyStats rows, the raw events are already there:
 * use `scripts/reaggregate-analytics.ts --from <day> --to <day>`, which is
 * windowed, dry-runnable, and idempotent.
 *
 * Run (only if you actually want fabricated events):
 *   npx tsx scripts/backfill-analytics.ts --yes-fabricate-events
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

// Refuse to run on a bare invocation. This script's name promises a repair and
// its behaviour is a rewrite, so the flag is the only thing standing between
// "backfill the missing days" and a permanently polluted event table.
if (!process.argv.includes('--yes-fabricate-events')) {
  console.error('❌ scripts/backfill-analytics.ts FABRICATES AnalyticsEvent rows; it does not re-aggregate.')
  console.error('   To rebuild missing AnalyticsDailyStats rows from the real events, use:')
  console.error('     npx tsx scripts/reaggregate-analytics.ts --from YYYY-MM-DD --to YYYY-MM-DD --dry-run')
  console.error('   If you genuinely want synthetic events, re-run with --yes-fabricate-events.')
  process.exit(1)
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
