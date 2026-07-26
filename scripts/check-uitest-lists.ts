import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const lists = await prisma.taskList.findMany({
    where: { name: { startsWith: 'UITest List' } },
    select: { id: true, name: true, createdAt: true },
  })
  console.log(`found ${lists.length} UITest lists in PROD`)
  for (const l of lists) console.log(` ${l.id} ${l.name} ${l.createdAt.toISOString()}`)
  await prisma.$disconnect()
}
main().catch(async (e) => { console.error(e.message); await prisma.$disconnect(); process.exit(1) })
