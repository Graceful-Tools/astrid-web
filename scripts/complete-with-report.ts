import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const raw = process.argv.slice(2).join(' ')
  const blocks = raw.split('|||').map(b => b.trim()).filter(Boolean)
  const me = await prisma.user.findFirst({ where: { email: 'jonparis@gmail.com' } })
  for (const block of blocks) {
    const [prefix, ...rest] = block.split('::')
    const report = rest.join('::').trim()
    const task = await prisma.task.findFirst({ where: { id: { startsWith: prefix.trim() } } })
    if (!task) { console.log('NOT FOUND', prefix); continue }
    await prisma.comment.create({ data: { taskId: task.id, authorId: me!.id, content: report } })
    await prisma.task.update({ where: { id: task.id }, data: { completed: true, completedAt: new Date() } })
    console.log('completed:', task.title.slice(0, 60))
  }
  await prisma.$disconnect()
}
main()
