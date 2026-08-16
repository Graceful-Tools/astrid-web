/**
 * DELETE /api/v1/lists/:id/members/:userId must invalidate the removed user's
 * Redis cache (task e27642cc — "removing a cloud agent doesn't get removed,
 * keeps showing back up").
 *
 * WHAT THE EVIDENCE RULED OUT FIRST, because the obvious readings were wrong:
 *
 *   Something re-adds the agent?  No. In production astrid.oc@astrid.cc's two
 *   ListMember rows date from February 2026 — six months old, not recreated.
 *   Registration is the only code that adds an agent to a list and it is an
 *   explicit, rate-limited call.
 *
 *   The GET synthesises agents?  No. It returns owner + real listMembers +
 *   pending invites, nothing more.
 *
 *   The permission gate rejects owners?  No. Both routes resolve ownership
 *   through getUserRoleInList.
 *
 * What remained: the row IS deleted, and a stale cache re-serves it. The
 * legacy handler calls invalidateMemberCache(memberId) right after deleting;
 * the v1 handler deleted, broadcast SSE, and returned — never touching Redis,
 * and never importing a cache module at all.
 *
 * So the member disappears until the next read repopulates from
 * `userLists`/`userTasks`, and then returns. "Keeps showing back up" is
 * exactly what a cache that outlives the write looks like.
 *
 * This is not agent-specific — any removed member would come back. Agents are
 * where it got noticed because a person removed from a list has no reason to
 * look again.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api-auth-wrapper', () => ({
  withAuth: (_opts: unknown, handler: (...args: unknown[]) => unknown) =>
    (req: NextRequest, ctx: unknown) =>
      handler(req, { userId: 'owner-1', scopes: ['lists:write'], source: 'oauth' }, ctx),
}))

const findUnique = vi.hoisted(() => vi.fn())
const memberDelete = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: { findUnique },
    listMember: { delete: memberDelete },
  },
}))

vi.mock('@/lib/sse-utils', () => ({ broadcastToUsers: vi.fn() }))
vi.mock('@/lib/api-auth-middleware', () => ({ getDeprecationWarning: () => null }))

const invalidateMemberCache = vi.hoisted(() => vi.fn())
const invalidateMemberCaches = vi.hoisted(() => vi.fn())
vi.mock('@/lib/list-member-operations', () => ({
  invalidateMemberCache,
  invalidateMemberCaches,
}))

const AGENT = 'agent-oc-1'

const LIST = {
  id: 'list-1',
  ownerId: 'owner-1',
  owner: { id: 'owner-1', name: 'Jon', email: 'jon@example.com', image: null, isAIAgent: false },
  listMembers: [
    {
      userId: AGENT,
      role: 'member',
      user: { id: AGENT, name: 'astrid.oc', email: 'astrid.oc@astrid.cc', image: null, isAIAgent: true },
    },
  ],
}

function del() {
  return new NextRequest(`http://localhost/api/v1/lists/list-1/members/${AGENT}`, { method: 'DELETE' })
}
const ctx = { params: Promise.resolve({ id: 'list-1', userId: AGENT }) } as never

beforeEach(() => {
  vi.clearAllMocks()
  findUnique.mockResolvedValue(LIST)
  memberDelete.mockResolvedValue({})
})

describe('v1 member removal invalidates the cache (task e27642cc)', () => {
  it('deletes the membership row', async () => {
    const { DELETE } = await import('@/app/api/v1/lists/[id]/members/[userId]/route')
    const res = await DELETE(del(), ctx)

    expect(res.status).toBe(200)
    expect(memberDelete).toHaveBeenCalledWith({
      where: { listId_userId: { listId: 'list-1', userId: AGENT } },
    })
  })

  it('invalidates the removed member\'s cache, so the removal survives a refetch', async () => {
    // Without this the row is gone but userLists/userTasks still name them,
    // and the member reappears on the next read — the reported symptom.
    const { DELETE } = await import('@/app/api/v1/lists/[id]/members/[userId]/route')
    await DELETE(del(), ctx)

    const invalidatedIds = [
      ...invalidateMemberCache.mock.calls.flat(),
      ...invalidateMemberCaches.mock.calls.flat().flat(),
    ]
    expect(invalidatedIds).toContain(AGENT)
  })

  it('does not invalidate when the removal was refused', async () => {
    // A 404/403 path must not clear caches for a membership that still exists.
    findUnique.mockResolvedValue({ ...LIST, listMembers: [] })
    const { DELETE } = await import('@/app/api/v1/lists/[id]/members/[userId]/route')

    const res = await DELETE(del(), ctx)

    expect(res.status).toBe(404)
    expect(invalidateMemberCache).not.toHaveBeenCalled()
    expect(invalidateMemberCaches).not.toHaveBeenCalled()
  })
})
