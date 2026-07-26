// Print attachment/secure-file info for a task's comments (id prefix).
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const t = await prisma.task.findFirst({ where: { id: { startsWith: process.argv[2] } }, select: { id: true } })
  if (!t) { console.log('task not found'); return }
  const comments = await prisma.comment.findMany({
    where: { taskId: t.id },
    select: { id: true, content: true, attachmentUrl: true, attachmentName: true, secureFiles: true },
  })
  console.log(JSON.stringify(comments, null, 2).slice(0, 2000))
  await prisma.$disconnect()
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
