import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  for (const id of process.argv.slice(2)) {
    const t = await prisma.task.findUnique({ where: { id },
      include: { comments: { orderBy: { createdAt: 'asc' } } } })
    if (!t) { console.log('not found', id); continue }
    console.log('='.repeat(70))
    console.log('TITLE:', t.title)
    console.log('ID:', t.id)
    console.log('DESCRIPTION:\n' + (t.description || '(empty)'))
    for (const c of t.comments) {
      const body = (c.content || '')
      if (body.includes('changed description') || body.includes('created this task')) continue
      console.log('--- comment:', body.slice(0, 500))
    }
  }
  await prisma.$disconnect()
}
main()
