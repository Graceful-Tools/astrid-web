// Post a completion report + mark complete, matching a task by id PREFIX (the create script
// prints 8-char prefixes). Usage: DATABASE_URL=<prod> npx tsx scripts/complete-by-prefix.ts <file.json>
// file.json: [{ "idPrefix": "9a60b697", "report": "<markdown>" }, ...]
import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'fs'

const prisma = new PrismaClient()
const AUTHOR_ID = process.env.COMMENT_AUTHOR_ID || 'cmeje966q0000k1045si7zrz3'

async function main() {
  const items: { idPrefix: string; report: string }[] = JSON.parse(readFileSync(process.argv[2], 'utf8'))
  for (const { idPrefix, report } of items) {
    const t = await prisma.task.findFirst({
      where: { id: { startsWith: idPrefix } },
      select: { id: true, title: true, completed: true },
    })
    if (!t) { console.log(`SKIP (not found): ${idPrefix}`); continue }
    await prisma.comment.create({ data: { content: report, taskId: t.id, authorId: AUTHOR_ID } })
    if (!t.completed) {
      await prisma.task.update({
        where: { id: t.id },
        data: { completed: true, completedAt: new Date(), completedSource: 'astrid' },
      })
    }
    console.log(`✅ ${t.title.slice(0, 64)}`)
  }
  await prisma.$disconnect()
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
