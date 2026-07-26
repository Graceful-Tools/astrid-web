import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const lists = await prisma.taskList.findMany({
    where: { name: { startsWith: 'UITest List' } },
    select: { id: true, name: true, createdAt: true, ownerId: true },
    orderBy: { createdAt: 'desc' },
  })
  for (const l of lists) console.log(l.name, '|', l.createdAt.toISOString(), '| owner', l.ownerId)
  await prisma.$disconnect()
}
main()
