#!/usr/bin/env tsx

import { prisma } from '../lib/prisma'

async function checkUser() {
  const user = await prisma.user.findUnique({
    where: { email: 'jonparis@gmail.com' },
    select: { id: true, email: true }
  })

  if (!user) {
    console.log('❌ User not found')
    return
  }

  console.log('✅ User:', user)

  const lists = await prisma.taskList.findMany({
    where: { ownerId: user.id },
    select: {
      id: true,
      name: true,
      isVirtual: true,
      virtualListType: true,
      filterDueDate: true,
      filterAssignee: true
    },
    orderBy: { name: 'asc' }
  })

  console.log(`\n📋 Lists for jonparis@gmail.com (${lists.length} total):`)
  lists.forEach(list => {
    console.log(`- ${list.name}: isVirtual=${list.isVirtual}, type=${list.virtualListType}`)
  })

  // Check specifically for Today and I've Assigned
  const virtualLists = lists.filter(l => l.name === 'Today' || l.name === "I've Assigned")
  console.log(`\n🔍 Virtual lists: ${virtualLists.length}`)
  virtualLists.forEach(list => console.log(JSON.stringify(list, null, 2)))
}

checkUser().finally(() => prisma.$disconnect())
