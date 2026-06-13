import { describe, it, expect } from 'vitest'
import {
  getAllListMembers,
  hasListAccess,
  isListAdminOrOwner,
  isListOwner,
  getUserListRole,
  getListMemberIds,
  canAccessList,
} from '@/lib/list-member-utils'
import type { TaskList, User } from '@/types/task'

describe('List Member Utils - getAllListMembers', () => {
  const mockOwner: User = {
    id: 'owner-1',
    email: 'owner@example.com',
    name: 'Owner User',
  }

  const mockAdmin: User = {
    id: 'admin-1',
    email: 'admin@example.com',
    name: 'Admin User',
  }

  const mockMember: User = {
    id: 'member-1',
    email: 'member@example.com',
    name: 'Member User',
  }

  describe('Owner field', () => {
    it('should return owner from owner field', () => {
      const list: TaskList = {
        id: 'list-1',
        name: 'Test List',
        ownerId: mockOwner.id,
        owner: mockOwner,
        privacy: 'PRIVATE',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as TaskList

      const members = getAllListMembers(list)

      expect(members).toHaveLength(1)
      expect(members[0]).toMatchObject({
        id: mockOwner.id,
        role: 'owner',
        isOwner: true,
        isAdmin: false,
        isMember: false,
      })
    })
  })

  describe('ListMember table with roles', () => {
    it('should return admin from listMembers with user relation loaded', () => {
      const list: TaskList = {
        id: 'list-1',
        name: 'Test List',
        ownerId: mockOwner.id,
        owner: mockOwner,
        listMembers: [
          {
            id: 'lm-1',
            listId: 'list-1',
            userId: mockAdmin.id,
            role: 'admin',
            user: mockAdmin,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as any,
        ],
        privacy: 'PRIVATE',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as TaskList

      const members = getAllListMembers(list)

      expect(members).toHaveLength(2) // owner + admin
      expect(members.find(m => m.id === mockAdmin.id)).toMatchObject({
        id: mockAdmin.id,
        role: 'admin',
        isOwner: false,
        isAdmin: true,
        isMember: false,
      })
    })

    it('should return admin from listMembers WITHOUT user relation loaded (CRITICAL FIX)', () => {
      const list: TaskList = {
        id: 'list-1',
        name: 'Test List',
        ownerId: mockOwner.id,
        owner: mockOwner,
        listMembers: [
          {
            id: 'lm-1',
            listId: 'list-1',
            userId: mockAdmin.id, // Only userId, no user relation
            role: 'admin',
            // user: undefined - not loaded
            createdAt: new Date(),
            updatedAt: new Date(),
          } as any,
        ],
        privacy: 'PRIVATE',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as TaskList

      const members = getAllListMembers(list)

      expect(members).toHaveLength(2) // owner + admin
      const adminMember = members.find(m => m.id === mockAdmin.id)
      expect(adminMember).toBeDefined()
      expect(adminMember).toMatchObject({
        id: mockAdmin.id,
        role: 'admin',
        isOwner: false,
        isAdmin: true,
        isMember: false,
      })
    })

    it('should return member from listMembers WITHOUT user relation loaded', () => {
      const list: TaskList = {
        id: 'list-1',
        name: 'Test List',
        ownerId: mockOwner.id,
        owner: mockOwner,
        listMembers: [
          {
            id: 'lm-1',
            listId: 'list-1',
            userId: mockMember.id,
            role: 'member',
            // user: undefined - not loaded
            createdAt: new Date(),
            updatedAt: new Date(),
          } as any,
        ],
        privacy: 'PRIVATE',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as TaskList

      const members = getAllListMembers(list)

      expect(members).toHaveLength(2) // owner + member
      const memberEntry = members.find(m => m.id === mockMember.id)
      expect(memberEntry).toBeDefined()
      expect(memberEntry).toMatchObject({
        id: mockMember.id,
        role: 'member',
        isOwner: false,
        isAdmin: false,
        isMember: true,
      })
    })
  })

  describe('Deduplication', () => {
    it('should not duplicate owner if in admins array', () => {
      const list: TaskList = {
        id: 'list-1',
        name: 'Test List',
        ownerId: mockOwner.id,
        owner: mockOwner,
        admins: [mockOwner], // Owner is also in admins
        privacy: 'PRIVATE',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as TaskList

      const members = getAllListMembers(list)

      expect(members).toHaveLength(1)
      expect(members[0].role).toBe('owner') // Should be owner, not admin
    })

    it('should not duplicate members across old and new systems', () => {
      const list: TaskList = {
        id: 'list-1',
        name: 'Test List',
        ownerId: mockOwner.id,
        owner: mockOwner,
        members: [mockMember], // OLD system
        listMembers: [
          {
            id: 'lm-1',
            listId: 'list-1',
            userId: mockMember.id, // NEW system - same user
            role: 'member',
            user: mockMember,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as any,
        ],
        privacy: 'PRIVATE',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as TaskList

      const members = getAllListMembers(list)

      expect(members).toHaveLength(2) // owner + member (not duplicated)
      expect(members.filter(m => m.id === mockMember.id)).toHaveLength(1)
    })
  })
})

describe('List Member Utils - Permission Checks', () => {
  const mockOwner: User = {
    id: 'owner-1',
    email: 'owner@example.com',
    name: 'Owner User',
  }

  const mockAdmin: User = {
    id: 'admin-1',
    email: 'admin@example.com',
    name: 'Admin User',
  }

  const mockMember: User = {
    id: 'member-1',
    email: 'member@example.com',
    name: 'Member User',
  }

  const mockNonMember: User = {
    id: 'non-member-1',
    email: 'nonmember@example.com',
    name: 'Non Member',
  }

  describe('isListAdminOrOwner', () => {
    it('should return true for owner', () => {
      const list: TaskList = {
        id: 'list-1',
        name: 'Test List',
        ownerId: mockOwner.id,
        owner: mockOwner,
        privacy: 'PRIVATE',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as TaskList

      expect(isListAdminOrOwner(list, mockOwner.id)).toBe(true)
    })

    it('should return true for admin (via NEW system without user relation)', () => {
      const list: TaskList = {
        id: 'list-1',
        name: 'Test List',
        ownerId: mockOwner.id,
        owner: mockOwner,
        listMembers: [
          {
            id: 'lm-1',
            listId: 'list-1',
            userId: mockAdmin.id,
            role: 'admin',
            // No user relation loaded
            createdAt: new Date(),
            updatedAt: new Date(),
          } as any,
        ],
        privacy: 'PRIVATE',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as TaskList

      expect(isListAdminOrOwner(list, mockAdmin.id)).toBe(true)
    })

    it('should return false for regular member', () => {
      const list: TaskList = {
        id: 'list-1',
        name: 'Test List',
        ownerId: mockOwner.id,
        owner: mockOwner,
        members: [mockMember],
        privacy: 'PRIVATE',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as TaskList

      expect(isListAdminOrOwner(list, mockMember.id)).toBe(false)
    })

    it('should return false for non-member', () => {
      const list: TaskList = {
        id: 'list-1',
        name: 'Test List',
        ownerId: mockOwner.id,
        owner: mockOwner,
        privacy: 'PRIVATE',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as TaskList

      expect(isListAdminOrOwner(list, mockNonMember.id)).toBe(false)
    })
  })

  describe('hasListAccess', () => {
    it('should return true for admin via NEW system without user relation', () => {
      const list: TaskList = {
        id: 'list-1',
        name: 'Test List',
        ownerId: mockOwner.id,
        owner: mockOwner,
        listMembers: [
          {
            id: 'lm-1',
            listId: 'list-1',
            userId: mockAdmin.id,
            role: 'admin',
            createdAt: new Date(),
            updatedAt: new Date(),
          } as any,
        ],
        privacy: 'PRIVATE',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as TaskList

      expect(hasListAccess(list, mockAdmin.id)).toBe(true)
    })

    it('should return false for non-member', () => {
      const list: TaskList = {
        id: 'list-1',
        name: 'Test List',
        ownerId: mockOwner.id,
        owner: mockOwner,
        privacy: 'PRIVATE',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as TaskList

      expect(hasListAccess(list, mockNonMember.id)).toBe(false)
    })
  })

  describe('canAccessList', () => {
    it('should allow anyone to access public list', () => {
      const list: TaskList = {
        id: 'list-1',
        name: 'Public List',
        ownerId: mockOwner.id,
        owner: mockOwner,
        privacy: 'PUBLIC',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as TaskList

      expect(canAccessList(list, mockNonMember.id)).toBe(true)
      expect(canAccessList(list, undefined)).toBe(true)
    })

    it('should only allow members to access private list', () => {
      const list: TaskList = {
        id: 'list-1',
        name: 'Private List',
        ownerId: mockOwner.id,
        owner: mockOwner,
        privacy: 'PRIVATE',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as TaskList

      expect(canAccessList(list, mockOwner.id)).toBe(true)
      expect(canAccessList(list, mockNonMember.id)).toBe(false)
      expect(canAccessList(list, undefined)).toBe(false)
    })
  })

  describe('getUserListRole', () => {
    it('should return admin for user in listMembers without user relation', () => {
      const list: TaskList = {
        id: 'list-1',
        name: 'Test List',
        ownerId: mockOwner.id,
        owner: mockOwner,
        listMembers: [
          {
            id: 'lm-1',
            listId: 'list-1',
            userId: mockAdmin.id,
            role: 'admin',
            createdAt: new Date(),
            updatedAt: new Date(),
          } as any,
        ],
        privacy: 'PRIVATE',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as TaskList

      expect(getUserListRole(list, mockAdmin.id)).toBe('admin')
    })

    it('should return null for non-member', () => {
      const list: TaskList = {
        id: 'list-1',
        name: 'Test List',
        ownerId: mockOwner.id,
        owner: mockOwner,
        privacy: 'PRIVATE',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as TaskList

      expect(getUserListRole(list, mockNonMember.id)).toBeNull()
    })
  })

  // Board sub-task #3 — project membership grants access to a project's lists.
  // These checks must be ADDITIVE: project membership can only ever add a
  // member entry, never lower an existing list-level role, and must be a no-op
  // when the list carries no project.
  describe('Project membership (sub-task #3)', () => {
    const projectOwner: User = { id: 'p-owner', email: 'powner@example.com', name: 'Project Owner' }
    const projectMember: User = { id: 'p-member', email: 'pmember@example.com', name: 'Project Member' }
    const projectAdmin: User = { id: 'p-admin', email: 'padmin@example.com', name: 'Project Admin' }

    function listWithProject(extra: Record<string, unknown> = {}): TaskList {
      return {
        id: 'list-1',
        name: 'Project List',
        ownerId: mockOwner.id,
        owner: mockOwner,
        privacy: 'PRIVATE',
        createdAt: new Date(),
        updatedAt: new Date(),
        project: {
          ownerId: projectOwner.id,
          owner: projectOwner,
          members: [
            { userId: projectMember.id, role: 'member', user: projectMember },
            { userId: projectAdmin.id, role: 'admin', user: projectAdmin },
          ],
        },
        ...extra,
      } as unknown as TaskList
    }

    it('grants project owner admin-level access (mapped to admin)', () => {
      const list = listWithProject()
      expect(hasListAccess(list, projectOwner.id)).toBe(true)
      expect(isListAdminOrOwner(list, projectOwner.id)).toBe(true)
      expect(getUserListRole(list, projectOwner.id)).toBe('admin')
    })

    it('grants a project member member-level access', () => {
      const list = listWithProject()
      expect(hasListAccess(list, projectMember.id)).toBe(true)
      expect(getUserListRole(list, projectMember.id)).toBe('member')
      expect(isListAdminOrOwner(list, projectMember.id)).toBe(false)
    })

    it('maps a project admin to list admin', () => {
      const list = listWithProject()
      expect(getUserListRole(list, projectAdmin.id)).toBe('admin')
      expect(isListAdminOrOwner(list, projectAdmin.id)).toBe(true)
    })

    it('is a no-op when the list has no project (zero regression)', () => {
      const list: TaskList = {
        id: 'list-1',
        name: 'Test List',
        ownerId: mockOwner.id,
        owner: mockOwner,
        privacy: 'PRIVATE',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as TaskList
      expect(getAllListMembers(list)).toHaveLength(1)
      expect(hasListAccess(list, projectMember.id)).toBe(false)
    })

    it('does not lower an existing list-level admin to project member', () => {
      // User is a list admin AND a plain project member — must stay admin.
      const list = listWithProject({
        listMembers: [
          { id: 'lm-1', listId: 'list-1', userId: projectMember.id, role: 'admin', user: projectMember },
        ],
      })
      expect(getUserListRole(list, projectMember.id)).toBe('admin')
    })

    it('works with ownerId-only / userId-only project shape (no user relations)', () => {
      const list = {
        id: 'list-1',
        name: 'Project List',
        ownerId: mockOwner.id,
        owner: mockOwner,
        privacy: 'PRIVATE',
        createdAt: new Date(),
        updatedAt: new Date(),
        project: {
          ownerId: projectOwner.id,
          members: [{ userId: projectMember.id, role: 'member' }],
        },
      } as unknown as TaskList
      expect(hasListAccess(list, projectOwner.id)).toBe(true)
      expect(hasListAccess(list, projectMember.id)).toBe(true)
      expect(getListMemberIds(list)).toEqual(
        expect.arrayContaining([mockOwner.id, projectOwner.id, projectMember.id]),
      )
    })
  })
})
