import { describe, it, expect } from 'vitest'
import {
  getUserRoleInList,
  canUserViewList,
  canUserEditTasks,
  canUserEditTask,
  canUserManageList,
  canUserManageMembers,
  canUserDeleteList,
  canEditListSettings,
  isSystemListId,
  SYSTEM_LIST_IDS,
} from '@/lib/list-permissions'
import { isListAdminOrOwner } from '@/lib/list-member-utils'
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

    // Reuse Phase 1 (task e2803305): getUserRoleInList must be the single source
    // of truth, unioning every data source the inline checks used — including the
    // owner relation object (some payloads carry `owner` but not `ownerId`).
    it('should return owner when matched via the owner relation object', () => {
      const list = {
        id: 'list-1',
        name: 'Test List',
        ownerId: 'someone-else',
        owner: { id: mockUser.id, email: 'o@example.com' },
        privacy: 'PRIVATE',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as TaskList

      expect(getUserRoleInList(mockUser, list)).toBe('owner')
    })
  })

  // Reuse Phase 1 (task e2803305): the legacy denormalized `admins` array is used
  // by ~8 inline call sites. The canonical helper must recognize it so those
  // sites can be converted safely.
  describe('Legacy admins array', () => {
    it('should return admin for a user only present in the legacy admins array', () => {
      const list = {
        id: 'list-1',
        name: 'Test List',
        ownerId: 'someone-else',
        admins: [{ id: 'admin-user' }],
        listMembers: [],
        privacy: 'PRIVATE',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as TaskList

      expect(getUserRoleInList({ id: 'admin-user' }, list)).toBe('admin')
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

/**
 * Reuse Phase 1 (task e2803305): three modules independently answered
 * "may this user change this list?" —
 *   lib/list-permissions.ts        (getUserRoleInList + canUser* helpers)
 *   lib/task-manager-utils.ts      (canEditListSettings)
 *   lib/list-member-utils.ts       (isListAdminOrOwner)
 * plus ~53 inline `ownerId === user.id || admins.some(...)` checks across 16
 * files. Three implementations of one rule means three ways to disagree.
 *
 * These pin that the surviving entry points give the same answer, so the
 * inline call sites can converge on them safely.
 */
describe('permission helpers agree (task e2803305)', () => {
  const user = { id: 'u1' }
  const other = { id: 'u2' }

  const asOwner = { id: 'l1', ownerId: 'u1' }
  const asOwnerRelation = { id: 'l1', owner: { id: 'u1' } }
  const asLegacyAdmin = { id: 'l1', ownerId: 'u2', admins: [{ id: 'u1' }] }
  const asMemberAdmin = { id: 'l1', ownerId: 'u2', listMembers: [{ userId: 'u1', role: 'admin' }] }
  const asPlainMember = { id: 'l1', ownerId: 'u2', listMembers: [{ userId: 'u1', role: 'member' }] }
  const asStranger = { id: 'l1', ownerId: 'u2' }

  it('treats owner, legacy admins[] and listMembers admin as manage-capable', () => {
    for (const list of [asOwner, asOwnerRelation, asLegacyAdmin, asMemberAdmin]) {
      expect(canUserManageList(user, list as never), JSON.stringify(list)).toBe(true)
    }
  })

  it('does not grant management to plain members or strangers', () => {
    expect(canUserManageList(user, asPlainMember as never)).toBe(false)
    expect(canUserManageList(user, asStranger as never)).toBe(false)
    expect(canUserManageList(other, asOwner as never)).toBe(false)
  })

  it('canEditListSettings matches canUserManageList for real lists', () => {
    for (const list of [asOwner, asOwnerRelation, asLegacyAdmin, asMemberAdmin, asPlainMember, asStranger]) {
      expect(
        canEditListSettings(list as never, user.id),
        `disagreement on ${JSON.stringify(list)}`,
      ).toBe(canUserManageList(user, list as never))
    }
  })

  it('refuses settings edits on built-in system lists regardless of role', () => {
    // These are virtual views, not lists anyone owns.
    for (const id of SYSTEM_LIST_IDS) {
      expect(canEditListSettings({ id, ownerId: 'u1' } as never, user.id)).toBe(false)
      expect(isSystemListId(id)).toBe(true)
    }
    expect(isSystemListId('a-real-list-id')).toBe(false)
  })

  it('isListAdminOrOwner agrees with the canonical role lookup', () => {
    for (const list of [asOwner, asLegacyAdmin, asMemberAdmin, asPlainMember, asStranger]) {
      expect(
        isListAdminOrOwner(list as never, user.id),
        `disagreement on ${JSON.stringify(list)}`,
      ).toBe(canUserManageList(user, list as never))
    }
  })

  it('returns false for a missing user or list instead of throwing', () => {
    expect(canEditListSettings(asOwner as never, undefined)).toBe(false)
    expect(canUserManageList(user, null as never)).toBe(false)
  })
})
