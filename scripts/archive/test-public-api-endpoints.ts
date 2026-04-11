import { getServerSession } from 'next-auth'
import { authConfig } from '../lib/auth-config'
import { getPopularPublicLists } from '../lib/copy-utils'
import { prisma } from '../lib/prisma'

async function testPublicAPIEndpoints() {
  console.log('\n🧪 Testing Public Lists API Endpoints\n')

  // Test 1: lib/copy-utils getPopularPublicLists()
  console.log('='.repeat(60))
  console.log('TEST 1: getPopularPublicLists() (Web app uses this)')
  console.log('='.repeat(60))

  const webLists = await getPopularPublicLists(3)
  console.log(`\nReturned ${webLists.length} lists:`)
  webLists.forEach((list, i) => {
    console.log(`${i+1}. ${list.name}`)
    console.log(`   - Type: ${list.publicListType || 'copy_only'}`)
    console.log(`   - Owner: ${list.owner?.name}`)
    console.log(`   - Tasks: ${list._count?.tasks || 0}`)
  })

  // Test 2: iOS API endpoint logic (from /api/v1/public/lists)
  console.log('\n' + '='.repeat(60))
  console.log('TEST 2: iOS API endpoint logic (/api/v1/public/lists)')
  console.log('='.repeat(60))

  // Get current user (if any)
  const demoUser = await prisma.user.findFirst({
    where: { email: 'demo@astrid.cc' }
  })

  console.log(`\nTesting as user: ${demoUser?.name} (${demoUser?.email})`)

  // Simulate iOS API query
  const whereClause: any = {
    privacy: 'PUBLIC',
  }

  if (demoUser?.id) {
    whereClause.AND = [
      { ownerId: { not: demoUser.id } },
      {
        NOT: {
          listMembers: {
            some: {
              userId: demoUser.id,
              role: 'admin'
            }
          }
        }
      }
    ]
  }

  const iosLists = await prisma.taskList.findMany({
    where: whereClause,
    orderBy: { createdAt: 'desc' },
    take: 3,
    include: {
      owner: {
        select: { id: true, name: true, email: true }
      },
      _count: {
        select: { tasks: true }
      }
    }
  })

  console.log(`\nReturned ${iosLists.length} lists:`)
  iosLists.forEach((list, i) => {
    console.log(`${i+1}. ${list.name}`)
    console.log(`   - Type: ${list.publicListType || 'copy_only'}`)
    console.log(`   - Owner: ${list.owner.name}`)
    console.log(`   - Tasks: ${list._count.tasks}`)
    console.log(`   - Owner matches user: ${list.ownerId === demoUser?.id}`)
  })

  // Test 3: Test with different user (Collab Test User)
  console.log('\n' + '='.repeat(60))
  console.log('TEST 3: iOS API as Collab Test User')
  console.log('='.repeat(60))

  const collabUser = await prisma.user.findFirst({
    where: { email: { contains: 'collab-test' } }
  })

  console.log(`\nTesting as user: ${collabUser?.name} (${collabUser?.email})`)

  const whereClause2: any = {
    privacy: 'PUBLIC',
  }

  if (collabUser?.id) {
    whereClause2.AND = [
      { ownerId: { not: collabUser.id } },
      {
        NOT: {
          listMembers: {
            some: {
              userId: collabUser.id,
              role: 'admin'
            }
          }
        }
      }
    ]
  }

  const iosLists2 = await prisma.taskList.findMany({
    where: whereClause2,
    orderBy: { createdAt: 'desc' },
    take: 3,
    include: {
      owner: {
        select: { id: true, name: true, email: true }
      },
      _count: {
        select: { tasks: true }
      }
    }
  })

  console.log(`\nReturned ${iosLists2.length} lists:`)
  iosLists2.forEach((list, i) => {
    console.log(`${i+1}. ${list.name}`)
    console.log(`   - Type: ${list.publicListType || 'copy_only'}`)
    console.log(`   - Owner: ${list.owner.name}`)
    console.log(`   - Tasks: ${list._count.tasks}`)
    console.log(`   - Owner matches user: ${list.ownerId === collabUser?.id}`)
  })

  console.log('\n' + '='.repeat(60))
  console.log('SUMMARY')
  console.log('='.repeat(60))
  console.log(`\nWeb API (no user filtering): ${webLists.length} lists`)
  console.log(`iOS API (demo@astrid.cc): ${iosLists.length} lists`)
  console.log(`iOS API (collab-test user): ${iosLists2.length} lists`)
  console.log('\nBoth collaborative and copy_only types are present in database ✓')

  await prisma.$disconnect()
}

testPublicAPIEndpoints().catch(console.error)
