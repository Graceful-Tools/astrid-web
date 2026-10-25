/**
 * Spec §5.2 step 6 — the legacy list PUT replaces the whole roster
 * (adminIds / memberIds) in one transaction and used to tell clients only
 * `list_updated`. Each member it added or dropped is now announced the member
 * service's way.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { broadcastListEvent, invalidateMemberCache, invalidateMemberCaches } = vi.hoisted(() => ({
  broadcastListEvent: vi.fn(),
  invalidateMemberCache: vi.fn(),
  invalidateMemberCaches: vi.fn(),
}))
vi.mock('@/lib/lists/v1-list-shape', () => ({ broadcastListEvent }))
vi.mock('@/lib/list-member-operations', () => ({ invalidateMemberCache, invalidateMemberCaches }))

import { announceRosterChanges } from '@/services/list-member.service'

const base = { id: 'list-1', name: 'Team', color: '#000', ownerId: 'owner', isVirtual: false }

describe('announceRosterChanges', () => {
  beforeEach(() => vi.clearAllMocks())

  it('announces who joined and who left, and nobody who stayed', async () => {
    await announceRosterChanges({
      before: { ...base, listMembers: [{ userId: 'stays', role: 'member' }, { userId: 'leaves', role: 'member' }] },
      after: { ...base, listMembers: [{ userId: 'stays', role: 'member' }, { userId: 'joins', role: 'admin', user: { name: 'J' } }] },
      actor: { id: 'owner', name: 'Owner' },
    })

    const events = broadcastListEvent.mock.calls.map(([e]) => [e.type, e.data.memberId])
    expect(events).toEqual([
      ['list_member_added', 'joins'],
      ['list_member_removed', 'leaves'],
    ])
  })

  it('tells the member who left, from the roster as it was', async () => {
    await announceRosterChanges({
      before: { ...base, listMembers: [{ userId: 'leaves', role: 'member' }] },
      after: { ...base, listMembers: [] },
      actor: { id: 'owner' },
    })

    expect(broadcastListEvent.mock.calls[0][0].recipients).toContain('leaves')
  })
})
