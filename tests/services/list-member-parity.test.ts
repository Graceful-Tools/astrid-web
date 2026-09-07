/**
 * Cross-surface contract test for list-membership changes (epic 9dedd8aa).
 *
 * The epic's second sentence names three areas: tasks (done), comments (done)
 * and "list-membership changes". This is that third one, and it is the worst
 * of the three, because here the surfaces do not merely duplicate work — they
 * emit DIFFERENT EVENT NAMES and DIFFERENT PAYLOADS for the same act, and the
 * client has been patched to paper over it:
 *
 *   add     legacy  list_member_added   { listId, listName, listColor,
 *                                         inviterName, newMemberId,
 *                                         newMemberEmail, role }  + cache
 *           v1      list_member_added   { listId, member: {...} }  NO cache
 *           MCP     — nothing at all —                             NO cache
 *
 *   role    legacy  list_member_role_changed / list_admin_role_granted
 *                                       { listId, listName, memberId,
 *                                         updatedBy, newRole }     + cache
 *           v1      list_member_updated { listId, userId, role }    NO cache
 *           MCP     — nothing at all —                             NO cache
 *
 *   remove  legacy  list_member_removed { listId, listName, listColor,
 *                                         removedMemberId, removedBy } + cache
 *           v1      list_member_removed { listId, userId }          + cache
 *           MCP     — nothing at all —                             NO cache
 *
 * What that costs, concretely:
 *
 *   - A role change made from iOS/Mac emits `list_member_updated`, which
 *     hooks/task-manager/useTaskListState.ts does not handle at all. The
 *     member's permissions never update in an open web client. The legacy name
 *     has the mirror-image bug: hooks/use-cache-sync.ts does not handle
 *     `list_member_role_changed`, so that path leaves a stale cache. Each name
 *     is handled by exactly one half of the client.
 *   - Being added or removed through v1 sends no `listName`, so the toast
 *     renders "You were removed from undefined".
 *   - v1 removal identifies the member as `userId`, but the client's
 *     affectedMemberId() reads `newMemberId ?? memberId ?? member?.id`. That
 *     function exists ONLY to absorb this drift, and it still does not cover
 *     v1's third spelling.
 *   - Every membership change made through MCP is invisible: no event, and a
 *     member cache that stays stale until it expires.
 *
 * These tests assert one act means one thing. The payload asserted is the
 * union, so no client loses a field it reads today.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const broadcastToUsers = vi.hoisted(() => vi.fn())
const invalidateMemberCache = vi.hoisted(() => vi.fn())
const invalidateMemberCaches = vi.hoisted(() => vi.fn())
const getUnifiedSession = vi.hoisted(() => vi.fn())
const authenticateAPI = vi.hoisted(() => vi.fn())
const resolveMCPActor = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: { findUnique: vi.fn(), findFirst: vi.fn() },
    listMember: {
      findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(),
      update: vi.fn(), updateMany: vi.fn(), delete: vi.fn(), deleteMany: vi.fn(),
    },
    listInvite: { create: vi.fn(), findFirst: vi.fn(), deleteMany: vi.fn() },
    user: { findUnique: vi.fn(), findFirst: vi.fn() },
  },
}))

vi.mock('@/lib/sse-utils', () => ({ broadcastToUsers, sendEventToUser: vi.fn() }))

vi.mock('@/lib/list-member-operations', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  invalidateMemberCache,
  invalidateMemberCaches,
}))

vi.mock('@/lib/session-utils', () => ({ getUnifiedSession }))

vi.mock('@/lib/api-auth-middleware', () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    authenticateAPI,
    requireScopes: vi.fn(),
    getDeprecationWarning: vi.fn(() => null),
    UnauthorizedError,
    ForbiddenError,
  }
})

vi.mock('@/app/api/mcp/operations/handlers/shared', () => ({
  resolveMCPActor,
  getListMemberIdsByListId: vi.fn(async () => ['owner-1', 'member-1']),
}))

vi.mock('@/lib/email', () => ({ sendListInvitationEmail: vi.fn() }))

import { prisma } from '@/lib/prisma'

const mockPrisma = vi.mocked(prisma, true)

const OWNER = 'owner-1'
const MEMBER = 'member-1'
const ADDED = 'added-1'

const list = () => ({
  id: 'list-1',
  name: 'Astrid Web To-do',
  color: '#ef4444',
  ownerId: OWNER,
  privacy: 'PRIVATE',
  listMembers: [
    { userId: OWNER, role: 'admin', user: { id: OWNER, name: 'Jon', email: 'jon@example.com', image: null } },
    { userId: MEMBER, role: 'member', user: { id: MEMBER, name: 'M', email: 'm@example.com', image: null } },
  ],
})

const eventOfType = (...types: string[]) =>
  broadcastToUsers.mock.calls.find(call => types.includes((call[1] as { type: string }).type))

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.taskList.findUnique.mockResolvedValue(list() as never)
  mockPrisma.taskList.findFirst.mockResolvedValue(list() as never)
  // The add path asks "is this user already a member?" and must get null; the
  // role and remove paths ask "does this member exist?" and must get a row.
  mockPrisma.listMember.findFirst.mockImplementation(
    (async (args: { where?: { userId?: string } }) =>
      args?.where?.userId === MEMBER
        ? { listId: 'list-1', userId: MEMBER, role: 'member' }
        : null) as never,
  )
  mockPrisma.listMember.count = vi.fn().mockResolvedValue(2) as never
  mockPrisma.listMember.findUnique.mockResolvedValue({ listId: 'list-1', userId: MEMBER, role: 'member' } as never)
  mockPrisma.listMember.create.mockResolvedValue({ listId: 'list-1', userId: ADDED, role: 'member' } as never)
  mockPrisma.listMember.update.mockResolvedValue({ listId: 'list-1', userId: MEMBER, role: 'admin' } as never)
  mockPrisma.listMember.updateMany.mockResolvedValue({ count: 1 } as never)
  mockPrisma.listMember.delete.mockResolvedValue({ listId: 'list-1', userId: MEMBER } as never)
  mockPrisma.listMember.deleteMany.mockResolvedValue({ count: 1 } as never)
  mockPrisma.listInvite.create.mockResolvedValue({ id: 'inv-1', token: 't' } as never)
  mockPrisma.user.findUnique.mockResolvedValue({
    id: ADDED, name: 'New', email: 'new@example.com', image: null,
  } as never)
  mockPrisma.user.findFirst.mockResolvedValue({
    id: ADDED, name: 'New', email: 'new@example.com', image: null,
  } as never)

  getUnifiedSession.mockResolvedValue({ user: { id: OWNER, name: 'Jon', email: 'jon@example.com' } })
  authenticateAPI.mockResolvedValue({
    userId: OWNER, user: { id: OWNER, name: 'Jon', email: 'jon@example.com' },
    source: 'oauth', scopes: ['lists:write'],
  })
  resolveMCPActor.mockResolvedValue({
    userId: OWNER, user: { id: OWNER, name: 'Jon', email: 'jon@example.com' }, token: { userId: OWNER },
  })
})

/**
 * The MCP surface is the one that emits nothing at all today, so it is the
 * reason every describe below includes it.
 */
const addSurfaces = [
  {
    name: 'v1 POST /api/v1/lists/:id/members',
    run: async () => {
      const { POST } = await import('@/app/api/v1/lists/[id]/members/route')
      return POST(new Request('http://localhost/api/v1/lists/list-1/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'new@example.com', role: 'member' }),
      }) as never, { params: Promise.resolve({ id: 'list-1' }) } as never)
    },
  },
  {
    name: 'MCP addListMember',
    run: async () => {
      const { addListMember } = await import('@/app/api/mcp/operations/handlers/member-operations')
      return addListMember('mcp-token', 'list-1', 'new@example.com', 'member', OWNER)
    },
  },
]

const roleSurfaces = [
  {
    name: 'v1 PATCH /api/v1/lists/:id/members/:userId',
    run: async () => {
      const mod = await import('@/app/api/v1/lists/[id]/members/[userId]/route')
      const handler = (mod as Record<string, unknown>).PATCH ?? (mod as Record<string, unknown>).PUT
      return (handler as (r: unknown, c: unknown) => Promise<unknown>)(
        new Request('http://localhost/api/v1/lists/list-1/members/member-1', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'admin' }),
        }) as never,
        { params: Promise.resolve({ id: 'list-1', userId: MEMBER }) } as never,
      )
    },
  },
  {
    name: 'MCP updateListMember',
    run: async () => {
      const { updateListMember } = await import('@/app/api/mcp/operations/handlers/member-operations')
      return updateListMember('mcp-token', 'list-1', MEMBER, 'admin', OWNER)
    },
  },
]

const removeSurfaces = [
  {
    name: 'v1 DELETE /api/v1/lists/:id/members/:userId',
    run: async () => {
      const { DELETE } = await import('@/app/api/v1/lists/[id]/members/[userId]/route')
      return DELETE(new Request('http://localhost/api/v1/lists/list-1/members/member-1', {
        method: 'DELETE',
      }) as never, { params: Promise.resolve({ id: 'list-1', userId: MEMBER }) } as never)
    },
  },
  {
    name: 'MCP removeListMember',
    run: async () => {
      const { removeListMember } = await import('@/app/api/mcp/operations/handlers/member-operations')
      return removeListMember('mcp-token', 'list-1', MEMBER, undefined, false, OWNER)
    },
  },
]

describe('adding a member means the same thing on every surface (epic 9dedd8aa)', () => {
  for (const surface of addSurfaces) {
    it(`${surface.name} broadcasts list_member_added with the fields the client reads`, async () => {
      await surface.run()

      const event = eventOfType('list_member_added')
      expect(event, `${surface.name} broadcast no list_member_added`).toBeTruthy()

      const data = (event![1] as { data: Record<string, unknown> }).data
      // affectedMemberId() in useTaskListState reads newMemberId first, and the
      // toast reads listName. Without both, the person added is not told.
      expect(data.newMemberId).toBe(ADDED)
      expect(data.listName).toBe('Astrid Web To-do')
      expect(data.inviterName).toBeTruthy()
    })

    it(`${surface.name} invalidates the new member's cache`, async () => {
      await surface.run()
      expect(
        invalidateMemberCache.mock.calls.length + invalidateMemberCaches.mock.calls.length,
        `${surface.name} added a member without invalidating their cache, so the list stays ` +
          `missing from their own view until the cache expires.`,
      ).toBeGreaterThan(0)
    })
  }
})

describe('changing a role means the same thing on every surface (epic 9dedd8aa)', () => {
  for (const surface of roleSurfaces) {
    it(`${surface.name} broadcasts a role-change event the UI actually handles`, async () => {
      await surface.run()

      // useTaskListState handles these two names and NOT list_member_updated.
      const event = eventOfType('list_member_role_changed', 'list_admin_role_granted')
      expect(
        event,
        `${surface.name} broadcast no event that hooks/task-manager/useTaskListState.ts handles. ` +
          `It emits list_member_updated, which only use-cache-sync reads, so the member's ` +
          `permissions never change in an open web client.`,
      ).toBeTruthy()

      const data = (event![1] as { data: Record<string, unknown> }).data
      expect(data.memberId).toBe(MEMBER)
      expect(data.newRole).toBe('admin')
      expect(data.listName).toBe('Astrid Web To-do')
    })
  }
})

describe('removing a member means the same thing on every surface (epic 9dedd8aa)', () => {
  for (const surface of removeSurfaces) {
    it(`${surface.name} broadcasts list_member_removed with the fields the client reads`, async () => {
      await surface.run()

      const event = eventOfType('list_member_removed')
      expect(event, `${surface.name} broadcast no list_member_removed`).toBeTruthy()

      const data = (event![1] as { data: Record<string, unknown> }).data
      expect(
        data.removedMemberId,
        `${surface.name} does not say WHO was removed in a spelling the client reads, so the ` +
          `removal cannot be gated to the affected member.`,
      ).toBe(MEMBER)
      expect(data.listName).toBe('Astrid Web To-do')
    })
  }
})
