/**
 * Migration script to populate the new ListMember table with existing member relationships
 * This ensures users don't lose access to their lists after the member management refactor
 */

const { PrismaClient } = require('@prisma/client')

async function migrateMemberData() {
  const prisma = new PrismaClient()
  
  try {
    console.log('🔄 Starting member data migration...')
    
    // Get all lists with their current members and admins
    const lists = await prisma.taskList.findMany({
      include: {
        admins: true,
        members: true
      }
    })
    
    console.log(`📋 Found ${lists.length} lists to migrate`)
    
    let totalMigrated = 0
    
    for (const list of lists) {
      const memberEntries = []
      
      // Add admins to the new ListMember table
      for (const admin of list.admins) {
        memberEntries.push({
          listId: list.id,
          userId: admin.id,
          role: 'admin'
        })
      }
      
      // Add members to the new ListMember table
      for (const member of list.members) {
        memberEntries.push({
          listId: list.id,
          userId: member.id,
          role: 'member'
        })
      }
      
      if (memberEntries.length > 0) {
        try {
          await prisma.listMember.createMany({
            data: memberEntries,
            skipDuplicates: true // Avoid conflicts if some data already exists
          })
          
          console.log(`✅ Migrated ${memberEntries.length} members for list "${list.name}"`)
          totalMigrated += memberEntries.length
        } catch (error) {
          console.log(`⚠️  Skipping duplicates for list "${list.name}" (likely already migrated)`)
        }
      }
    }
    
    console.log(`🎉 Migration complete! Migrated ${totalMigrated} member relationships`)
    
  } catch (error) {
    console.error('❌ Migration failed:', error)
  } finally {
    await prisma.$disconnect()
  }
}

// Run the migration
migrateMemberData()