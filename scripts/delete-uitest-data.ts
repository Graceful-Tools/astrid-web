// Remove UITest-created lists/tasks that leaked into prod via the shared outbox.
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const tasks = await prisma.task.deleteMany({ where: { title: { startsWith: 'UITest task' } } })
  const lists = await prisma.taskList.findMany({ where: { name: { startsWith: 'UITest List' } }, select: { id: true } })
  for (const l of lists) {
    await prisma.task.deleteMany({ where: { lists: { some: { id: l.id } } } })   // any stragglers in these lists
    await prisma.taskList.delete({ where: { id: l.id } })
  }
  console.log(`deleted ${tasks.count} UITest tasks + ${lists.length} UITest lists`)
  await prisma.$disconnect()
}
main().catch(async (e) => { console.error(e.message); await prisma.$disconnect(); process.exit(1) })
