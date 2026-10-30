/**
 * Debug script to test role update functionality
 */

const { PrismaClient } = require('@prisma/client')

async function testRoleUpdate() {
  const prisma = new PrismaClient()
  
  try {
    console.log('🧪 Testing role update functionality...\n')
    
    // Find a member to test with
    const membersList = await prisma.listMember.findMany({
      include: {
        user: { select: { email: true, name: true } },
        list: { select: { name: true, ownerId: true } }
      }
    })
    
    console.log('📋 Current ListMember entries:')
    membersList.forEach(member => {
      console.log(`${member.user.email} is ${member.role} of "${member.list.name}"`)
    })
    
    if (membersList.length === 0) {
      console.log('❌ No members found to test with')
      return
    }
    
    // Try to update a member role directly
    const testMember = membersList.find(m => m.role === 'member')
    if (testMember) {
      console.log(`\n🔄 Attempting to promote ${testMember.user.email} to admin...`)
      
      const result = await prisma.listMember.updateMany({
        where: {
          listId: testMember.listId,
          userId: testMember.userId
        },
        data: { role: 'admin' }
      })
      
      console.log(`✅ Updated ${result.count} records`)
      
      // Verify the update
      const updated = await prisma.listMember.findFirst({
        where: {
          listId: testMember.listId,
          userId: testMember.userId
        },
        include: {
          user: { select: { email: true } }
        }
      })
      
      console.log(`🔍 Verification: ${updated.user.email} is now ${updated.role}`)
      
      // Revert back for testing
      await prisma.listMember.updateMany({
        where: {
          listId: testMember.listId,
          userId: testMember.userId
        },
        data: { role: 'member' }
      })
      
      console.log(`↩️  Reverted back to member`)
    } else {
      console.log('❌ No regular members found to test role promotion')
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error)
  } finally {
    await prisma.$disconnect()
  }
}

testRoleUpdate()