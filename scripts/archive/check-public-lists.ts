import { prisma } from '../lib/prisma'

async function checkPublicLists() {
  const publicLists = await prisma.taskList.findMany({
    where: {
      privacy: 'PUBLIC',
      isVirtual: false
    },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      _count: { select: { tasks: true } }
    },
    orderBy: { createdAt: 'desc' },
    take: 10
  })

  console.log('\n📊 Public Lists in Database:\n')
  console.log('Total public lists:', publicLists.length)
  console.log('\nList details:')
  publicLists.forEach((list, i) => {
    console.log(`${i+1}. ${list.name}`)
    console.log(`   - ID: ${list.id}`)
    console.log(`   - Type: ${list.publicListType || 'copy_only (default)'}`)
    console.log(`   - Owner: ${list.owner.name} (${list.owner.email})`)
    console.log(`   - Tasks: ${list._count.tasks}`)
    console.log(`   - Created: ${list.createdAt}`)
  })

  await prisma.$disconnect()
}

checkPublicLists().catch(console.error)
