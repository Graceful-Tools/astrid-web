/**
 * AWTD-1525: pending invite tokens go only to callers who can manage members.
 *
 * An invite token is what accepting an invite presents. The list reads returned
 * `listInvites` (token included) to every reader: plain members, people who see
 * the list through a project, and any signed-in stranger on a PUBLIC list.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { invitationsVisibleTo, shapeV1List } from '@/lib/lists/v1-list-shape'

const invite = { id: 'i1', listId: 'l1', email: 'x@example.com', role: 'member', token: 'secret-token', createdAt: new Date(), createdBy: 'owner-1' }

const list = {
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
} as never

describe('AWTD-1525 invitations on list reads', () => {
  it('shows invites (with tokens) to the owner and to list admins', () => {
    expect(invitationsVisibleTo(list, 'owner-1')).toEqual([invite])
    expect(invitationsVisibleTo(list, 'admin-1')).toEqual([invite])
  })

  it('shows nothing to a plain member or a stranger', () => {
    expect(invitationsVisibleTo(list, 'member-1')).toEqual([])
    expect(invitationsVisibleTo(list, 'stranger')).toEqual([])
  })

  it('shapeV1List returns no tokens to a non-admin reader', () => {
    const body = shapeV1List(list, new Map(), new Map(), 'member-1')
    expect(body.invitations).toEqual([])
    expect(JSON.stringify(body)).not.toContain('secret-token')
  })

  it('shapeV1List keeps invitations for the owner', () => {
    expect(shapeV1List(list, new Map(), new Map(), 'owner-1').invitations).toEqual([invite])
  })
})
