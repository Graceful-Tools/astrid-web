// Complete an Astrid task and post a report read from a FILE (preserves newlines,
// unlike complete-with-report.ts which joins argv with spaces).
// Usage: npx tsx scripts/complete-from-file.ts <task-id-prefix> <report-file> [--comment-only]
import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'fs'
const prisma = new PrismaClient()
async function main() {
  const [prefix, file, mode] = process.argv.slice(2)
  const report = readFileSync(file, 'utf8').trim()
  const me = await prisma.user.findFirst({ where: { email: 'jonparis@gmail.com' } })
  const task = await prisma.task.findFirst({ where: { id: { startsWith: prefix } } })
  if (!task) { console.log('NOT FOUND', prefix); return }
  await prisma.comment.create({ data: { taskId: task.id, authorId: me!.id, content: report } })
  if (mode !== '--comment-only') {
    await prisma.task.update({ where: { id: task.id }, data: { completed: true, completedAt: new Date() } })
  }
  console.log(mode === '--comment-only' ? 'commented:' : 'completed:', task.title.slice(0, 60))
  await prisma.$disconnect()
}
main()
