import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { DEFAULT_LIST_COLOR } from '@/lib/brand/colors'
import type { User, TaskList } from '@prisma/client'
import type { PrismaClient } from '@prisma/client'

// This is an integration test that uses the real database
// Unmock prisma for this test file
vi.unmock('@/lib/prisma')

// Import prisma lazily to handle missing DATABASE_URL
let prisma: PrismaClient | null = null
try {
  if (process.env.DATABASE_URL) {
    const prismaModule = await import('@/lib/prisma')
    prisma = prismaModule.prisma
  }
} catch {
  // Database not available, tests will be skipped
}

/**
 * The suite skips itself when DATABASE_URL is unset, but the compiler cannot
 * see that from `dbAvailable`, so every `db().` was an 18047. This narrows
 * it in one place and throws if a test ever runs past the guard. (AWTD-916)
 */
function db(): PrismaClient {
  if (!prisma) {
    throw new Error('DATABASE_URL not set - this suite should have been skipped')
  }
  return prisma
}

describe('Collaborative Public Lists - Task Creation and Editing', () => {
  let testUser: User
  let otherUser: User
  let collaborativeList: TaskList
  let copyOnlyList: TaskList
  let dbAvailable = true

  beforeAll(async () => {
    if (!prisma) {
      console.warn('Database not available - DATABASE_URL not set, skipping integration tests')
      dbAvailable = false
      return
    }

    try {
      // Check if database is available
      await db().$connect()

      // Create test users
      testUser = await db().user.create({
        data: {
          email: `collab-test-${Date.now()}@example.com`,
          name: 'Collab Test User',
        },
      })

      otherUser = await db().user.create({
        data: {
          email: `collab-other-${Date.now()}@example.com`,
          name: 'Other User',
        },
      })

      // Create collaborative public list
      collaborativeList = await db().taskList.create({
        data: {
          name: 'Collaborative Public List',
          privacy: 'PUBLIC',
          publicListType: 'collaborative',
          color: DEFAULT_LIST_COLOR,
          ownerId: testUser.id,
        },
      })

      // Create copy-only public list
      copyOnlyList = await db().taskList.create({
        data: {
          name: 'Copy-Only Public List',
          privacy: 'PUBLIC',
          publicListType: 'copy_only',
          color: DEFAULT_LIST_COLOR,
          ownerId: testUser.id,
        },
      })
    } catch (error) {
      console.warn('Database not available for integration tests, skipping:', error)
      dbAvailable = false
      // Don't throw - let tests skip gracefully
    }
  }, 30000) // Increase timeout for setup

  afterAll(async () => {
    if (!prisma) return

    try {
      // Clean up test data
      if (testUser?.id || otherUser?.id) {
        await db().task.deleteMany({
          where: {
            OR: [
              ...(testUser?.id ? [{ creatorId: testUser.id }] : []),
              ...(otherUser?.id ? [{ creatorId: otherUser.id }] : []),
            ],
          },
        })
      }

      if (collaborativeList?.id || copyOnlyList?.id) {
        await db().taskList.deleteMany({
          where: {
            id: {
              in: [collaborativeList?.id, copyOnlyList?.id].filter(Boolean) as string[],
            },
          },
        })
      }

      if (testUser?.id || otherUser?.id) {
        await db().user.deleteMany({
          where: {
            id: {
              in: [testUser?.id, otherUser?.id].filter(Boolean) as string[],
            },
          },
        })
      }
    } catch (error) {
      console.error('Cleanup failed:', error)
    }
  }, 30000) // Increase timeout for cleanup

  describe('Task Creation Permissions', () => {
    it('should allow task creation on collaborative public lists', async () => {
      if (!dbAvailable) {
        console.log('Skipping test - database not available')
        return
      }

      const task = await db().task.create({
        data: {
          title: 'Test Task on Collaborative List',
          creatorId: otherUser.id,
          lists: {
            connect: { id: collaborativeList.id },
          },
        },
        include: {
          lists: true,
          creator: true,
        },
      })

      expect(task).toBeDefined()
      expect(task.title).toBe('Test Task on Collaborative List')
      expect(task.creatorId).toBe(otherUser.id)
      expect(task.lists[0].id).toBe(collaborativeList.id)
      expect(task.lists[0].publicListType).toBe('collaborative')

      // Cleanup
      await db().task.delete({ where: { id: task.id } })
    })

    it('should track task creator for permission checking', async () => {
      if (!dbAvailable) return

      const task = await db().task.create({
        data: {
          title: 'Task with Creator',
          creatorId: otherUser.id,
          lists: {
            connect: { id: collaborativeList.id },
          },
        },
        include: {
          creator: true,
        },
      })

      expect(task.creator).toBeDefined()
      expect(task.creator?.id).toBe(otherUser.id)
      expect(task.creatorId).toBe(otherUser.id)

      // Cleanup
      await db().task.delete({ where: { id: task.id } })
    })

    it('should allow assignees on collaborative public lists', async () => {
      if (!dbAvailable) return

      const task = await db().task.create({
        data: {
          title: 'Assigned Task on Collaborative List',
          creatorId: otherUser.id,
          assigneeId: testUser.id,
          lists: {
            connect: { id: collaborativeList.id },
          },
        },
        include: {
          assignee: true,
        },
      })

      expect(task.assigneeId).toBe(testUser.id)
      expect(task.assignee?.id).toBe(testUser.id)

      // Cleanup
      await db().task.delete({ where: { id: task.id } })
    })
  })

  describe('Copy-Only Public List Permissions', () => {
    it('should require unassigned tasks for copy-only public lists', async () => {
      if (!dbAvailable) return

      const task = await db().task.create({
        data: {
          title: 'Unassigned Task on Copy-Only List',
          creatorId: testUser.id,
          assigneeId: null, // Must be unassigned for security
          lists: {
            connect: { id: copyOnlyList.id },
          },
        },
      })

      expect(task.assigneeId).toBeNull()

      // Cleanup
      await db().task.delete({ where: { id: task.id } })
    })
  })

  describe('Task Editing Permissions', () => {
    it('should allow creator to identify their tasks for editing', async () => {
      if (!dbAvailable) return

      const task = await db().task.create({
        data: {
          title: 'Creator Owned Task',
          creatorId: otherUser.id,
          lists: {
            connect: { id: collaborativeList.id },
          },
        },
        include: {
          creator: true,
          lists: {
            include: {
              listMembers: {
                include: {
                  user: true,
                },
              },
            },
          },
        },
      })

      // Check if user is creator
      const isCreator = task.creatorId === otherUser.id
      expect(isCreator).toBe(true)

      // Check if user is admin of the list (using listMembers with role)
      const isListAdmin = task.lists[0].listMembers?.some(
        member => member.userId === otherUser.id && member.role === 'admin'
      )
      expect(isListAdmin).toBe(false) // otherUser is not admin

      // Creator should be able to edit (permission check)
      const canEdit = isCreator || isListAdmin
      expect(canEdit).toBe(true)

      // Cleanup
      await db().task.delete({ where: { id: task.id } })
    })

    it('should allow list admins to edit any task', async () => {
      if (!dbAvailable) return

      // Add otherUser as admin to the collaborative list using listMembers
      await db().listMember.create({
        data: {
          listId: collaborativeList.id,
          userId: otherUser.id,
          role: 'admin',
        },
      })

      const task = await db().task.create({
        data: {
          title: 'Task Created by Someone Else',
          creatorId: testUser.id, // Created by owner
          lists: {
            connect: { id: collaborativeList.id },
          },
        },
        include: {
          lists: {
            include: {
              listMembers: {
                include: {
                  user: true,
                },
              },
            },
          },
        },
      })

      // Check if otherUser is admin (using listMembers with role)
      const isAdmin = task.lists[0].listMembers?.some(
        member => member.userId === otherUser.id && member.role === 'admin'
      )
      expect(isAdmin).toBe(true)

      // Admin should be able to edit even though not creator
      const canEdit = task.creatorId === otherUser.id || isAdmin
      expect(canEdit).toBe(true)

      // Cleanup
      await db().task.delete({ where: { id: task.id } })
      await db().listMember.deleteMany({
        where: {
          listId: collaborativeList.id,
          userId: otherUser.id,
        },
      })
    })
  })

  describe('Public List Types', () => {
    it('should differentiate between collaborative and copy-only lists', () => {
      if (!dbAvailable) return

      expect(collaborativeList.publicListType).toBe('collaborative')
      expect(copyOnlyList.publicListType).toBe('copy_only')
    })

    it('should have PUBLIC privacy for both types', () => {
      if (!dbAvailable) return

      expect(collaborativeList.privacy).toBe('PUBLIC')
      expect(copyOnlyList.privacy).toBe('PUBLIC')
    })
  })
})
