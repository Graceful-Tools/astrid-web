// @ts-nocheck - Debug script may reference legacy schema fields for comparison
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function testMembersAndDefaults() {
  const listId = 'a623f322-4c3c-49b5-8a94-d2d9f00c82ba' // Astrid Bugs & Polish

  console.log('📊 Testing List Members and Defaults')
  console.log('=====================================\n')

  // Get list from database with all relationships
  const list = await prisma.taskList.findUnique({
    where: { id: listId },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      admins: { select: { id: true, name: true, email: true } },
      members: { select: { id: true, name: true, email: true } },
      listMembers: {
        include: {
          user: { select: { id: true, name: true, email: true } }
        }
      }
    }
  })

  if (!list) {
    console.log('❌ List not found!')
    await prisma.$disconnect()
    return
  }

  console.log('📋 List Name:', list.name)
  console.log('\n👥 MEMBERS FROM DATABASE:')
  console.log('  Owner:', list.owner?.email || 'none')
  console.log('  Admins:', list.admins?.length || 0, 'total')
  list.admins?.forEach(admin => console.log('    -', admin.email))
  console.log('  Members:', list.members?.length || 0, 'total')
  list.members?.forEach(member => console.log('    -', member.email))
  console.log('  ListMembers:', list.listMembers?.length || 0, 'total')
  list.listMembers?.forEach(lm => console.log('    -', lm.user?.email, `(${lm.role})`))

  console.log('\n⚙️  DEFAULT TASK SETTINGS:')
  console.log('  defaultPriority:', list.defaultPriority ?? 'null')
  console.log('  defaultDueDate:', list.defaultDueDate ?? 'null')
  console.log('  defaultDueTime:', list.defaultDueTime ?? 'null')
  console.log('  defaultIsPrivate:', list.defaultIsPrivate ?? 'null')
  console.log('  defaultRepeating:', list.defaultRepeating ?? 'null')
  console.log('  defaultAssigneeId:', list.defaultAssigneeId ?? 'null')

  await prisma.$disconnect()
}

testMembersAndDefaults().catch(console.error)
