import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const lists = await prisma.taskList.findMany({
    where: { name: { startsWith: 'UITest List' } },
    select: { id: true, name: true },
  })
  const listIds = lists.map(l => l.id)
  const tasks = await prisma.task.findMany({
    where: { OR: [
      { title: { startsWith: 'UITest ' } },
      { title: { in: ['Alpha task', 'Beta task', 'Gamma task'] } },
      // `lists` is a direct relation to TaskList, so match its id — there is
      // no join-row `listId` to filter on.
      ...(listIds.length ? [{ lists: { some: { id: { in: listIds } } } }] : []),
    ] },
    select: { id: true, title: true },
  })
  console.log(`found ${lists.length} UITest lists, ${tasks.length} test tasks`)
  if (process.argv.includes('--delete')) {
    for (const t of tasks) await prisma.task.delete({ where: { id: t.id } }).catch(() => {})
    for (const l of lists) await prisma.taskList.delete({ where: { id: l.id } }).catch(() => {})
    console.log(`deleted ${tasks.length} tasks and ${lists.length} lists`)
  } else {
    console.log(lists.map(l => l.name).join(', '))
    console.log(tasks.slice(0, 12).map(t => t.title).join(' | '))
  }
  await prisma.$disconnect()
}
main()
