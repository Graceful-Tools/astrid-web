/**
 * Fix missing list creators in ListMember table
 * This script adds list owners as admin members if they're not already in the ListMember table
 */

const { PrismaClient } = require('@prisma/client')

async function fixMissingCreators() {
  const prisma = new PrismaClient()
  
  try {
    console.log('🔧 Fixing missing list creators...\n')
    
    // Find all lists and their owners
    const allLists = await prisma.taskList.findMany({
      select: {
        id: true,
        name: true,
        ownerId: true,
        listMembers: {
          select: {
            userId: true,
            role: true
          }
        }
      }
    })
    
    console.log(`📋 Found ${allLists.length} lists to check`)
    
    let fixed = 0
    
    for (const list of allLists) {
      // Check if the owner is already in the ListMember table for this list
      const ownerIsMember = list.listMembers.some(member => member.userId === list.ownerId)
      
      if (!ownerIsMember) {
        console.log(`➕ Adding owner as admin member for "${list.name}"`)
        
        await prisma.listMember.create({
          data: {
            listId: list.id,
            userId: list.ownerId,
            role: 'admin'
          }
        })
        
        fixed++
      } else {
        console.log(`✅ Owner already member of "${list.name}"`)
      }
    }
    
    console.log(`\n🎉 Fixed ${fixed} lists`)
    
  } catch (error) {
    console.error('❌ Fix failed:', error)
  } finally {
    await prisma.$disconnect()
  }
}

fixMissingCreators()