// Batch-create tasks in the Astrid iOS to-do list (direct Prisma — OAuth path is flaky).
// Usage: DATABASE_URL=<prod> npx tsx scripts/create-ios-tasks.ts <tasks.json>
// tasks.json: [{ "title": "...", "description": "...", "priority": 0-3 }, ...]
import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'fs'

const prisma = new PrismaClient()
const CREATOR_ID = process.env.COMMENT_AUTHOR_ID || 'cmeje966q0000k1045si7zrz3' // jonparis@gmail.com
const IOS_LIST_ID = process.env.ASTRID_IOS_LIST_ID || 'aa41c1a3-bd63-4c6d-9b87-42c6e0aafa36'

async function main() {
  const file = process.argv[2]
  if (!file) { console.error('usage: create-ios-tasks.ts <tasks.json>'); process.exit(1) }
  const items: { title: string; description?: string; priority?: number }[] =
    JSON.parse(readFileSync(file, 'utf8'))

  // Guard against duplicates: skip a title that already exists (open) in the list.
  const existing = await prisma.task.findMany({
    where: { completed: false, lists: { some: { id: IOS_LIST_ID } } },
    select: { title: true },
  })
  const existingTitles = new Set(existing.map(t => t.title.trim().toLowerCase()))

  let created = 0, skipped = 0
  for (const { title, description = '', priority = 1 } of items) {
    if (existingTitles.has(title.trim().toLowerCase())) {
      console.log(`SKIP (exists): ${title.slice(0, 60)}`); skipped++; continue
    }
    const task = await prisma.task.create({
      data: {
        title, description, priority,
        creatorId: CREATOR_ID,
        lists: { connect: { id: IOS_LIST_ID } },
      },
      select: { id: true, title: true },
    })
    console.log(`✅ [${task.id.slice(0, 8)}] ${task.title.slice(0, 60)}`)
    created++
  }
  console.log(`\nDone: ${created} created, ${skipped} skipped.`)
  await prisma.$disconnect()
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
