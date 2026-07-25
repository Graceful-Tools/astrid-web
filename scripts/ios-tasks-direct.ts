import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
const listId = process.env.ASTRID_IOS_LIST_ID || 'aa41c1a3-bd63-4c6d-9b87-42c6e0aafa36'

async function main() {
  const list = await prisma.taskList.findUnique({
    where: { id: listId },
    select: { id: true, name: true },
  })
  if (!list) { console.error('List not found:', listId); process.exit(1) }

  const tasks = await prisma.task.findMany({
    where: { completed: false, lists: { some: { id: listId } } },
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    select: {
      id: true, title: true, description: true, priority: true,
      createdAt: true, dueDateTime: true,
      comments: {
        orderBy: { createdAt: 'asc' },
        select: { content: true, createdAt: true, author: { select: { name: true, email: true } } },
      },
    },
  })

  console.log(`\n# ${list.name} — ${tasks.length} open tasks\n`)
  for (const t of tasks) {
    console.log(`\n## [${t.priority}] ${t.title}`)
    console.log(`   id: ${t.id}  created: ${t.createdAt.toISOString().slice(0,10)}${t.dueDateTime ? '  due: '+t.dueDateTime.toISOString().slice(0,10) : ''}`)
    if (t.description?.trim()) console.log(`   desc: ${t.description.trim().replace(/\n/g,'\n         ')}`)
    if (t.comments.length) {
      console.log(`   --- ${t.comments.length} comment(s) ---`)
      for (const c of t.comments) {
        const who = c.author?.name || c.author?.email || 'unknown'
        console.log(`   • (${who}, ${c.createdAt.toISOString().slice(0,10)}) ${c.content.trim().replace(/\n/g,'\n     ')}`)
      }
    }
  }
  await prisma.$disconnect()
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
