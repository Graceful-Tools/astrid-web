/**
 * AWTD-1525: a list event never carries pending invite tokens to someone who
 * cannot manage members.
 *
 * `afterListUpdated` forwards the raw list row, invites included, as the event
 * `data`. `broadcastListEvent` used to spread that beside the per-viewer
 * `v1List`, so a plain member renaming-event got every token even though
 * `v1List.invitations` was filtered.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const invite = { id: 'i1', listId: 'l1', email: 'x@example.com', role: 'member', token: 'secret-token', createdAt: new Date(), createdBy: 'owner-1' }

const row = {
  id: 'l1',
  name: 'L',
  privacy: 'SHARED',
  ownerId: 'owner-1',
  owner: { id: 'owner-1' },
  listMembers: [
    { userId: 'admin-1', role: 'admin' },
    { userId: 'member-1', role: 'member' },
  ],
  listInvites: [invite],
  _count: { tasks: 0 },
}

const findUnique = vi.fn()
vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: { findUnique: (...a: unknown[]) => findUnique(...a) },
    userListFavorite: { findMany: async () => [] },
    userListViewPreference: { findMany: async () => [] },
  },
}))
vi.mock('@/lib/default-assignee', () => ({
  resolveDefaultAssignees: async () => new Map(),
  pickDefaultAssignee: () => null,
}))
vi.mock('@/lib/backends/list-wire', () => ({
  loadListBackendInfo: async () => new Map(),
  listBackendFields: () => ({}),
}))
const broadcastToUsers = vi.fn(async (_users: string[], _event: unknown) => {})
vi.mock('@/lib/sse-utils', () => ({ broadcastToUsers: (u: string[], e: unknown) => broadcastToUsers(u, e) }))

import { broadcastListEvent } from '@/lib/lists/v1-list-shape'

function eventFor(userId: string): string {
  const call = broadcastToUsers.mock.calls.find(([users]) => users.includes(userId))
  expect(call, `no event for ${userId}`).toBeTruthy()
  return JSON.stringify(call![1])
}

describe('AWTD-1525 list events and invite tokens', () => {
  beforeEach(() => {
    broadcastToUsers.mockClear()
    findUnique.mockReset()
  })

  it('a plain member and a lean recipient get no token anywhere in the event', async () => {
    findUnique.mockResolvedValue(row)
    await broadcastListEvent({
      listId: 'l1',
      recipients: ['member-1', 'admin-1', 'stranger'],
      type: 'list_updated',
      data: { ...row, name: 'Renamed' },
    })

    expect(eventFor('member-1')).not.toContain('secret-token')
    expect(eventFor('stranger')).not.toContain('secret-token')
    expect(eventFor('member-1')).toContain('Renamed')
  })

  it('a member manager still gets the invites, through v1List', async () => {
    findUnique.mockResolvedValue(row)
    await broadcastListEvent({ listId: 'l1', recipients: ['admin-1'], type: 'list_updated', data: { ...row } })

    const [, event] = broadcastToUsers.mock.calls[0] as [string[], { data: Record<string, unknown> & { v1List: { invitations: unknown[] } } }]
    expect(event.data.v1List.invitations).toHaveLength(1)
    expect(event.data.listInvites).toBeUndefined()
  })

  it('a failed list read sends everyone the lean event, still without tokens', async () => {
    findUnique.mockRejectedValue(new Error('db down'))
    await broadcastListEvent({ listId: 'l1', recipients: ['member-1'], type: 'list_updated', data: { ...row, invitations: [invite] } })

    expect(eventFor('member-1')).not.toContain('secret-token')
  })
})
