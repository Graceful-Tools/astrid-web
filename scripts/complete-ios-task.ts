// Post a completion report comment on an Astrid task and mark it complete.
// Usage: DATABASE_URL=<prod> npx tsx scripts/complete-ios-task.ts <completions.json>
// completions.json: [{ "id": "<taskId>", "report": "<markdown completion report>" }, ...]
import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'fs'

const prisma = new PrismaClient()
const AUTHOR_ID = process.env.COMMENT_AUTHOR_ID || 'cmeje966q0000k1045si7zrz3' // jonparis@gmail.com

async function main() {
  const file = process.argv[2]
  if (!file) { console.error('usage: complete-ios-task.ts <completions.json>'); process.exit(1) }
  const items: { id: string; report: string }[] = JSON.parse(readFileSync(file, 'utf8'))

  for (const { id, report } of items) {
    const task = await prisma.task.findUnique({ where: { id }, select: { id: true, title: true, completed: true } })
    if (!task) { console.log(`SKIP (not found): ${id}`); continue }
    await prisma.comment.create({ data: { content: report, taskId: id, authorId: AUTHOR_ID } })
    if (!task.completed) {
      await prisma.task.update({
        where: { id },
        data: { completed: true, completedAt: new Date(), completedSource: 'astrid' },
      })
    }
    console.log(`✅ ${task.title.slice(0, 60)}`)
  }
  await prisma.$disconnect()
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
