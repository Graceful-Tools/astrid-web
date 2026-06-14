import { describe, it, expect } from 'vitest'
import {
  getUserRoleInList,
  canUserViewList,
  canUserEditTasks,
  canUserEditTask,
  canUserManageList,
  canUserManageMembers,
  canUserDeleteList,
} from '@/lib/list-permissions'
import type { TaskList, User } from '@/types/task'

describe('List Permissions - getUserRoleInList', () => {
  const mockUser: User = {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
  }

  const mockOtherUser: User = {
    id: 'user-2',
    email: 'other@example.com',
    name: 'Other User',
  }

  const mockAdminUser: User = {
    id: 'user-admin',
    email: 'admin@example.com',
    name: 'Admin User',
  }

  describe('Owner role', () => {
    it('should return owner for list owner', () => {
      const list: TaskList = {
        id: 'list-1',
        name: 'Test List',
        ownerId: mockUser.id,
        privacy: 'PRIVATE',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as TaskList

      expect(getUserRoleInList(mockUser, list)).toBe('owner')
    })
  })

  describe('ListMember table with role field', () => {
    it('should return admin for user in listMembers with role=admin', () => {
      const list: TaskList = {
        id: 'list-1',
        name: 'Test List',
        ownerId: 'other-owner',
        privacy: 'PRIVATE',
        listMembers: [
          {
            id: 'lm-1',
            listId: 'list-1',
            userId: mockAdminUser.id,
            role: 'admin',
            user: mockAdminUser,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as any,
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      } as TaskList

      expect(getUserRoleInList(mockAdminUser, list)).toBe('admin')
    })

    it('should return member for user in listMembers with role=member', () => {
      const list: TaskList = {
        id: 'list-1',
        name: 'Test List',
        ownerId: 'other-owner',
        privacy: 'PRIVATE',
        listMembers: [
          {
            id: 'lm-1',
            listId: 'list-1',
            userId: mockUser.id,
            role: 'member',
            user: mockUser,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as any,
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      } as TaskList

      expect(getUserRoleInList(mockUser, list)).toBe('member')
    })

    it('should handle listMembers without user relation loaded', () => {
      const list: TaskList = {
        id: 'list-1',
        name: 'Test List',
        ownerId: 'other-owner',
        privacy: 'PRIVATE',
        listMembers: [
          {
            id: 'lm-1',
            listId: 'list-1',
            userId: mockAdminUser.id,
            role: 'admin',
            // No user relation loaded
            createdAt: new Date(),
            updatedAt: new Date(),
          } as any,
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      } as TaskList

      expect(getUserRoleInList(mockAdminUser, list)).toBe('admin')
    })
  })

  describe('Public lists', () => {
    it('should return viewer for public list when user has no explicit role', () => {
      const list: TaskList = {
        id: 'list-1',
        name: 'Public List',
        ownerId: 'other-owner',
        privacy: 'PUBLIC',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as TaskList

      expect(getUserRoleInList(mockUser, list)).toBe('viewer')
    })

    it('should return admin for public list admin via NEW system', () => {
      const list: TaskList = {
        id: 'list-1',
        name: 'Public List',
        ownerId: 'other-owner',
        privacy: 'PUBLIC',
        listMembers: [
          {
            id: 'lm-1',
            listId: 'list-1',
            userId: mockAdminUser.id,
            role: 'admin',
            user: mockAdminUser,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as any,
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      } as TaskList

      expect(getUserRoleInList(mockAdminUser, list)).toBe('admin')
    })
  })

  describe('No access scenarios', () => {
    it('should return null for private list when user has no role', () => {
      const list: TaskList = {
        id: 'list-1',
        name: 'Private List',
        ownerId: 'other-owner',
        privacy: 'PRIVATE',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as TaskList

      expect(getUserRoleInList(mockUser, list)).toBeNull()
    })

    it('should return null when user is null', () => {
      const list: TaskList = {
        id: 'list-1',
        name: 'Test List',
        ownerId: 'owner',
        privacy: 'PRIVATE',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as TaskList

      expect(getUserRoleInList(null as any, list)).toBeNull()
    })

    it('should return null when list is null', () => {
      expect(getUserRoleInList(mockUser, null as any)).toBeNull()
    })
  })
})

describe('List Permissions - Permission Functions', () => {
  const mockUser: User = {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
  }

  const mockAdminUserViaNewSystem: User = {
    id: 'admin-1',
    email: 'admin@example.com',
    name: 'Admin User',
  }

  describe('canUserManageList', () => {
    it('should allow owner to manage list', () => {
      const list: TaskList = {
        id: 'list-1',
        name: 'Test List',
        ownerId: mockUser.id,
        privacy: 'PRIVATE',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as TaskList

      expect(canUserManageList(mockUser, list)).toBe(true)
    })

    it('should allow admin (via NEW system) to manage list', () => {
      const list: TaskList = {
        id: 'list-1',
        name: 'Test List',
        ownerId: 'other-owner',
        privacy: 'PRIVATE',
        listMembers: [
          {
            id: 'lm-1',
            listId: 'list-1',
            userId: mockAdminUserViaNewSystem.id,
            role: 'admin',
            user: mockAdminUserViaNewSystem,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as any,
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      } as TaskList

      expect(canUserManageList(mockAdminUserViaNewSystem, list)).toBe(true)
    })

    it('should NOT allow regular member to manage list', () => {
      const memberUser: User = {
        id: 'member-1',
        email: 'member@example.com',
        name: 'Member User',
      }

      const list: TaskList = {
        id: 'list-1',
        name: 'Test List',
        ownerId: 'other-owner',
        privacy: 'PRIVATE',
        listMembers: [
          {
            id: 'lm-1',
            listId: 'list-1',
            userId: memberUser.id,
            role: 'member',
            user: memberUser,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as any,
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      } as TaskList

      expect(canUserManageList(memberUser, list)).toBe(false)
    })
  })

  describe('canUserManageMembers', () => {
    it('should allow admin (via NEW system) to manage members', () => {
      const list: TaskList = {
        id: 'list-1',
        name: 'Test List',
        ownerId: 'other-owner',
        privacy: 'PRIVATE',
        listMembers: [
          {
            id: 'lm-1',
            listId: 'list-1',
            userId: mockAdminUserViaNewSystem.id,
            role: 'admin',
            user: mockAdminUserViaNewSystem,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as any,
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      } as TaskList

      expect(canUserManageMembers(mockAdminUserViaNewSystem, list)).toBe(true)
    })
  })

  describe('canUserDeleteList', () => {
    it('should only allow owner to delete list', () => {
      const list: TaskList = {
        id: 'list-1',
        name: 'Test List',
        ownerId: mockUser.id,
        privacy: 'PRIVATE',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as TaskList

      expect(canUserDeleteList(mockUser, list)).toBe(true)
    })

    it('should NOT allow admin to delete list', () => {
      const list: TaskList = {
        id: 'list-1',
        name: 'Test List',
        ownerId: 'other-owner',
        privacy: 'PRIVATE',
        listMembers: [
          {
            id: 'lm-1',
            listId: 'list-1',
            userId: mockAdminUserViaNewSystem.id,
            role: 'admin',
            user: mockAdminUserViaNewSystem,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as any,
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      } as TaskList

      expect(canUserDeleteList(mockAdminUserViaNewSystem, list)).toBe(false)
    })
  })

  describe('canUserViewList', () => {
    it('should allow viewer on public list', () => {
      const list: TaskList = {
        id: 'list-1',
        name: 'Public List',
        ownerId: 'other-owner',
        privacy: 'PUBLIC',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as TaskList

      expect(canUserViewList(mockUser, list)).toBe(true)
    })

    it('should NOT allow non-member to view private list', () => {
      const list: TaskList = {
        id: 'list-1',
        name: 'Private List',
        ownerId: 'other-owner',
        privacy: 'PRIVATE',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as TaskList

      expect(canUserViewList(mockUser, list)).toBe(false)
    })
  })

})
