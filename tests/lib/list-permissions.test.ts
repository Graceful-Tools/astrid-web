import { describe, it, expect } from 'vitest'
import {
  getUserRoleInList,
  canUserViewList,
  canUserEditTasks,
  canUserEditTask,
  canUserManageList,
  canUserManageMembers,
  canUserDeleteList,
  hasExplicitListRole,
  canEditListSettings,
  isSystemListId,
  SYSTEM_LIST_IDS,
} from '@/lib/list-permissions'
import { isListAdminOrOwner, hasListAccess } from '@/lib/list-member-utils'
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

describe('legacy denormalized payload shapes (task e2803305)', () => {
  const user = { id: 'u1' }

  it('grants member access via the legacy members[] array', () => {
    // task-detail payloads carry `members`/`admins` rather than `listMembers`.
    const list = { id: 'l1', ownerId: 'u2', members: [{ id: 'u1' }] }
    expect(getUserRoleInList(user, list as never)).toBe('member')
    expect(canUserEditTasks(user, list as never)).toBe(true)
    expect(canUserManageList(user, list as never)).toBe(false)
  })

  it('still ranks admin above member when both arrays list the user', () => {
    const list = { id: 'l1', ownerId: 'u2', admins: [{ id: 'u1' }], members: [{ id: 'u1' }] }
    expect(getUserRoleInList(user, list as never)).toBe('admin')
  })
})

describe('hasExplicitListRole vs canUserEditTasks (task e2803305)', () => {
  const user = { id: 'u1' }
  const collaborative = { id: 'l1', ownerId: 'u2', privacy: 'PUBLIC', publicListType: 'collaborative' }

  it('excludes a viewer on a public collaborative list', () => {
    // canUserEditTasks deliberately lets viewers add tasks there; the call sites
    // that gate optimistic updates must NOT, or the write 403s.
    expect(canUserEditTasks(user, collaborative as never)).toBe(true)
    expect(hasExplicitListRole(user, collaborative as never)).toBe(false)
  })

  it('includes owner, admin and member across both payload shapes', () => {
    expect(hasExplicitListRole(user, { id: 'l', ownerId: 'u1' } as never)).toBe(true)
    expect(hasExplicitListRole(user, { id: 'l', ownerId: 'u2', admins: [{ id: 'u1' }] } as never)).toBe(true)
    expect(hasExplicitListRole(user, { id: 'l', ownerId: 'u2', members: [{ id: 'u1' }] } as never)).toBe(true)
    expect(hasExplicitListRole(user, { id: 'l', ownerId: 'u2', listMembers: [{ userId: 'u1', role: 'member' }] } as never)).toBe(true)
    expect(hasExplicitListRole(user, { id: 'l', ownerId: 'u2' } as never)).toBe(false)
  })
})

/**
 * Task e2803305 — found while converging the inline checks.
 *
 * ListMember.role defaults to "member" and is written lowercase in 31 places,
 * but three sites used uppercase:
 *   app/api/v1/lists/route.ts        wrote  role: 'MEMBER' at list creation
 *   app/api/v1/lists/[id]/route.ts   queried role: 'ADMIN'  (x2)
 *
 * So members added when a list was created got a role no lowercase comparison
 * matches — they had no access at all — and list admins could not update the
 * list because the query never found them. Rows written by the first bug are
 * already in the database, so the canonical lookup has to tolerate either
 * casing to repair those users, not just prevent new ones.
 */
describe('role casing is not a permission boundary (task e2803305)', () => {
  const user = { id: 'u1' }

  it('honours an uppercase MEMBER row written by the list-creation bug', () => {
    const list = { id: 'l1', ownerId: 'u2', listMembers: [{ userId: 'u1', role: 'MEMBER' }] }
    expect(getUserRoleInList(user, list as never)).toBe('member')
    expect(canUserEditTasks(user, list as never)).toBe(true)
  })

  it('honours an uppercase ADMIN row', () => {
    const list = { id: 'l1', ownerId: 'u2', listMembers: [{ userId: 'u1', role: 'ADMIN' }] }
    expect(getUserRoleInList(user, list as never)).toBe('admin')
    expect(canUserManageList(user, list as never)).toBe(true)
  })

  it('still rejects an unrelated role string', () => {
    const list = { id: 'l1', ownerId: 'u2', listMembers: [{ userId: 'u1', role: 'spectator' }] }
    expect(getUserRoleInList(user, list as never)).toBeNull()
  })
})

/**
 * Task e2803305: hasListAccess had the same defect as isListAdminOrOwner — it
 * derived access from getAllListMembers, which only records the owner when the
 * payload carries the `owner` relation object. A list fetched with just
 * `ownerId` therefore reported its own owner as having no access.
 *
 * Several API routes wrapped it in try/catch with a hand-rolled fallback doing
 * the ownerId compare — but the helper returns false rather than throwing, so
 * the fallback never ran and access was simply denied.
 */
describe('hasListAccess covers owners on ownerId-only payloads (task e2803305)', () => {
  it('grants the owner access without an owner relation object', () => {
    expect(hasListAccess({ id: 'l1', ownerId: 'u1' } as never, 'u1')).toBe(true)
  })

  it('still grants members and refuses strangers', () => {
    expect(hasListAccess({ id: 'l1', ownerId: 'u2', listMembers: [{ userId: 'u1', role: 'member' }] } as never, 'u1')).toBe(true)
    expect(hasListAccess({ id: 'l1', ownerId: 'u2' } as never, 'u1')).toBe(false)
  })

  it('does not treat a public-list viewer as having access', () => {
    // Public lists are readable, but that is not membership; routes gating
    // writes on hasListAccess must not be widened here.
    expect(hasListAccess({ id: 'l1', ownerId: 'u2', privacy: 'PUBLIC' } as never, 'u1')).toBe(false)
  })
})
