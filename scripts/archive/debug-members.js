/**
 * Debug script to check member relationships and help troubleshoot list visibility issues
 */

const { PrismaClient } = require('@prisma/client')

async function debugMemberData() {
  const prisma = new PrismaClient()
  
  try {
    console.log('🔍 Debugging member data...\n')
    
    // Find the jonparis user
    const jonUser = await prisma.user.findUnique({
      where: { email: 'jonparis@gmail.com' }
    })
    
    if (!jonUser) {
      console.log('❌ User jonparis@gmail.com not found in database')
      return
    }
    
    console.log('👤 Jon Paris user found:', {
      id: jonUser.id,
      email: jonUser.email,
      name: jonUser.name
    })
    
    // Check old member relationships
    const oldAdminLists = await prisma.taskList.findMany({
      where: { admins: { some: { id: jonUser.id } } },
      select: { id: true, name: true, ownerId: true }
    })
    
    const oldMemberLists = await prisma.taskList.findMany({
      where: { members: { some: { id: jonUser.id } } },
      select: { id: true, name: true, ownerId: true }
    })
    
    console.log('\n📋 Old member relationships:')
    console.log('Admin of:', oldAdminLists.map(l => l.name))
    console.log('Member of:', oldMemberLists.map(l => l.name))
    
    // Check new ListMember relationships
    const newMemberships = await prisma.listMember.findMany({
      where: { userId: jonUser.id },
      include: {
        list: { select: { id: true, name: true, ownerId: true } }
      }
    })
    
    console.log('\n🆕 New ListMember relationships:')
    newMemberships.forEach(m => {
      console.log(`${m.role} of "${m.list.name}" (ID: ${m.list.id})`)
    })
    
    // Check what lists the user should see
    const visibleLists = await prisma.taskList.findMany({
      where: {
        OR: [
          { ownerId: jonUser.id },
          { admins: { some: { id: jonUser.id } } },
          { members: { some: { id: jonUser.id } } },
          { listMembers: { some: { userId: jonUser.id } } },
          { privacy: "PUBLIC" }
        ]
      },
      select: { id: true, name: true, ownerId: true, privacy: true }
    })
    
    console.log('\n👀 Lists user should see:')
    visibleLists.forEach(l => {
      const access = l.ownerId === jonUser.id ? 'OWNER' : 
                    l.privacy === 'PUBLIC' ? 'PUBLIC' : 'MEMBER'
      console.log(`"${l.name}" (${access})`)
    })
    
    // Find the pdd user and their lists
    const pddUser = await prisma.user.findUnique({
      where: { email: 'pdd@kuoparis.com' }
    })
    
    if (pddUser) {
      console.log('\n👤 PDD user found:', {
        id: pddUser.id,
        email: pddUser.email
      })
      
      const pddLists = await prisma.taskList.findMany({
        where: { ownerId: pddUser.id },
        include: {
          listMembers: {
            include: { user: { select: { email: true, name: true } } }
          }
        }
      })
      
      console.log('\n📋 PDD\'s lists and their members:')
      pddLists.forEach(list => {
        console.log(`"${list.name}":`)
        list.listMembers.forEach(member => {
          console.log(`  - ${member.user.email} (${member.role})`)
        })
      })
    }
    
  } catch (error) {
    console.error('❌ Debug failed:', error)
  } finally {
    await prisma.$disconnect()
  }
}

debugMemberData()