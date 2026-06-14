/**
 * Route-level tests for the project member/sharing endpoints (board #3 write
 * side):
 *   GET    /api/projects/:id/members            (members + pending invites)
 *   POST   /api/projects/:id/members            (add existing user OR invite)
 *   DELETE /api/projects/:id/members            (cancel a pending invite)
 *   PATCH  /api/projects/:id/members            (re-role a pending invite)
 *   PATCH  /api/projects/:id/members/:userId    (re-role a member)
 *   DELETE /api/projects/:id/members/:userId    (remove a member)
 *
 * The projects-service layer is mocked — these focus on auth wiring, status
 * mapping, the add-or-invite fork, and Redis eviction. Service behaviour
 * (permission model, owner-immutability, dedupe) is covered by
 * tests/lib/projects-service.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/projects-service', () => ({
  addProjectMember: vi.fn(),
  removeProjectMember: vi.fn(),
  updateProjectMemberRole: vi.fn(),
  inviteProjectMemberByEmail: vi.fn(),
  getProjectMembers: vi.fn(),
  cancelProjectInvite: vi.fn(),
  updateProjectInviteRole: vi.fn(),
}))

vi.mock('@/lib/session-utils', () => ({
  getUnifiedSession: vi.fn(),
}))

vi.mock('@/lib/email', () => ({
  sendProjectInvitationEmail: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/feature-flags', () => ({
  requireProjectsBeta: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/lib/redis', () => ({
  RedisCache: {
    del: vi.fn().mockResolvedValue(undefined),
    keys: { userLists: (id: string) => `lists:user:${id}` },
  },
}))

import { GET, POST, DELETE as COLLECTION_DELETE, PATCH as COLLECTION_PATCH } from '@/app/api/projects/[id]/members/route'
import { PATCH, DELETE } from '@/app/api/projects/[id]/members/[userId]/route'
import {
  addProjectMember,
  removeProjectMember,
  updateProjectMemberRole,
  inviteProjectMemberByEmail,
  getProjectMembers,
  cancelProjectInvite,
  updateProjectInviteRole,
} from '@/lib/projects-service'
import { sendProjectInvitationEmail } from '@/lib/email'
import { requireProjectsBeta } from '@/lib/feature-flags'
import { getUnifiedSession } from '@/lib/session-utils'
import { RedisCache } from '@/lib/redis'

const mockAdd = vi.mocked(addProjectMember)
const mockRemove = vi.mocked(removeProjectMember)
const mockUpdate = vi.mocked(updateProjectMemberRole)
const mockInvite = vi.mocked(inviteProjectMemberByEmail)
const mockGetMembers = vi.mocked(getProjectMembers)
const mockCancelInvite = vi.mocked(cancelProjectInvite)
const mockUpdateInviteRole = vi.mocked(updateProjectInviteRole)
const mockSendEmail = vi.mocked(sendProjectInvitationEmail)
const mockBeta = vi.mocked(requireProjectsBeta)
const mockSession = vi.mocked(getUnifiedSession)
const mockDel = vi.mocked(RedisCache.del)

const PID = 'proj-1'
const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) })
const req = (method: string, path: string, body?: unknown) =>
  new NextRequest(`http://localhost${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
const postReq = (body: unknown) => req('POST', '/api/projects/proj-1/members', body)

beforeEach(() => {
  vi.clearAllMocks()
  mockSession.mockResolvedValue({ user: { id: 'owner-1', name: 'Owner', email: 'owner@x.com' } } as never)
  mockDel.mockResolvedValue(undefined as never)
  mockSendEmail.mockResolvedValue(undefined as never)
  mockBeta.mockResolvedValue(true as never)
})

describe('GET /api/projects/:id/members', () => {
  it('401 when unauthenticated', async () => {
    mockSession.mockResolvedValue(null as never)
    expect((await GET(req('GET', '/api/projects/proj-1/members'), ctx({ id: PID }))).status).toBe(401)
  })

  it('returns members + user_role', async () => {
    mockGetMembers.mockResolvedValue({
      members: [{ id: 'owner_o', user_id: 'owner-1', role: 'owner', email: 'owner@x.com', type: 'member' }],
      userRole: 'owner',
    } as never)
    const res = await GET(req('GET', '/api/projects/proj-1/members'), ctx({ id: PID }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user_role).toBe('owner')
    expect(body.members).toHaveLength(1)
  })

  it('403 when not permitted, 404 when missing', async () => {
    mockGetMembers.mockResolvedValueOnce({ error: 'forbidden' } as never)
    expect((await GET(req('GET', '/api/projects/proj-1/members'), ctx({ id: PID }))).status).toBe(403)
    mockGetMembers.mockResolvedValueOnce({ error: 'not_found' } as never)
    expect((await GET(req('GET', '/api/projects/proj-1/members'), ctx({ id: PID }))).status).toBe(404)
  })
})

describe('POST /api/projects/:id/members (add-or-invite)', () => {
  it('401 when unauthenticated', async () => {
    mockSession.mockResolvedValue(null as never)
    expect((await POST(postReq({ email: 't@x.com' }), ctx({ id: PID }))).status).toBe(401)
  })

  it('400 when email missing', async () => {
    expect((await POST(postReq({}), ctx({ id: PID }))).status).toBe(400)
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('403 when Projects beta is disabled', async () => {
    mockBeta.mockResolvedValue(false as never)
    const res = await POST(postReq({ email: 't@x.com' }), ctx({ id: PID }))
    expect(res.status).toBe(403)
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('existing user → 201 member + cache evicted, no invite', async () => {
    mockAdd.mockResolvedValue({
      member: { id: 'u1', name: 'T', email: 't@x.com', image: null, role: 'member' },
      userIdsToInvalidate: new Set(['u1']),
    } as never)
    const res = await POST(postReq({ email: 't@x.com', role: 'member' }), ctx({ id: PID }))
    expect(res.status).toBe(201)
    expect((await res.json()).member.id).toBe('u1')
    expect(mockDel).toHaveBeenCalledWith('lists:user:u1')
    expect(mockInvite).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('no account → falls back to invitation + sends email → 201 invited', async () => {
    mockAdd.mockResolvedValue({ error: 'user_not_found' } as never)
    mockInvite.mockResolvedValue({ token: 'inv_abc', email: 'new@x.com', role: 'member', projectName: 'Board' } as never)
    const res = await POST(postReq({ email: 'new@x.com', role: 'member' }), ctx({ id: PID }))
    expect(res.status).toBe(201)
    expect((await res.json()).invited).toBe(true)
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'new@x.com', projectName: 'Board', role: 'member' })
    )
  })

  it('admin grant of member role maps to "member" email role wording', async () => {
    mockAdd.mockResolvedValue({ error: 'user_not_found' } as never)
    mockInvite.mockResolvedValue({ token: 'inv_x', email: 'a@x.com', role: 'admin', projectName: 'Board' } as never)
    await POST(postReq({ email: 'a@x.com', role: 'admin' }), ctx({ id: PID }))
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({ role: 'manager' }))
  })

  it('invite forbidden → 403; invite invalid → 400', async () => {
    mockAdd.mockResolvedValue({ error: 'user_not_found' } as never)
    mockInvite.mockResolvedValueOnce({ error: 'forbidden' } as never)
    expect((await POST(postReq({ email: 'a@x.com' }), ctx({ id: PID }))).status).toBe(403)
    mockInvite.mockResolvedValueOnce({ error: 'invalid', message: 'dup' } as never)
    const res = await POST(postReq({ email: 'a@x.com' }), ctx({ id: PID }))
    expect(res.status).toBe(400)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('direct-add forbidden → 403 (not treated as invite)', async () => {
    mockAdd.mockResolvedValue({ error: 'forbidden' } as never)
    expect((await POST(postReq({ email: 'a@x.com', role: 'admin' }), ctx({ id: PID }))).status).toBe(403)
    expect(mockInvite).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/projects/:id/members (cancel invite)', () => {
  it('400 without { isInvitation, email }', async () => {
    expect((await COLLECTION_DELETE(req('DELETE', '/api/projects/proj-1/members', { email: 'a@x.com' }), ctx({ id: PID }))).status).toBe(400)
  })

  it('cancels a pending invite', async () => {
    mockCancelInvite.mockResolvedValue({ success: true } as never)
    const res = await COLLECTION_DELETE(req('DELETE', '/api/projects/proj-1/members', { email: 'a@x.com', isInvitation: true }), ctx({ id: PID }))
    expect(res.status).toBe(200)
    expect(mockCancelInvite).toHaveBeenCalledWith(PID, 'owner-1', 'a@x.com')
  })

  it('404 when the invite is gone', async () => {
    mockCancelInvite.mockResolvedValue({ error: 'not_found' } as never)
    expect((await COLLECTION_DELETE(req('DELETE', '/api/projects/proj-1/members', { email: 'a@x.com', isInvitation: true }), ctx({ id: PID }))).status).toBe(404)
  })
})

describe('PATCH /api/projects/:id/members (re-role invite)', () => {
  it('400 without { isInvitation, email }', async () => {
    expect((await COLLECTION_PATCH(req('PATCH', '/api/projects/proj-1/members', { role: 'admin' }), ctx({ id: PID }))).status).toBe(400)
  })

  it('updates a pending invite role', async () => {
    mockUpdateInviteRole.mockResolvedValue({ success: true } as never)
    const res = await COLLECTION_PATCH(req('PATCH', '/api/projects/proj-1/members', { email: 'a@x.com', isInvitation: true, role: 'admin' }), ctx({ id: PID }))
    expect(res.status).toBe(200)
    expect(mockUpdateInviteRole).toHaveBeenCalledWith(PID, 'owner-1', 'a@x.com', 'admin')
  })

  it('403 when forbidden', async () => {
    mockUpdateInviteRole.mockResolvedValue({ error: 'forbidden' } as never)
    expect((await COLLECTION_PATCH(req('PATCH', '/api/projects/proj-1/members', { email: 'a@x.com', isInvitation: true, role: 'admin' }), ctx({ id: PID }))).status).toBe(403)
  })
})

describe('PATCH /api/projects/:id/members/:userId (member role)', () => {
  const patchReq = (body: unknown) => req('PATCH', '/api/projects/proj-1/members/u1', body)
  it('200 and returns the updated member', async () => {
    mockUpdate.mockResolvedValue({ member: { id: 'u1', role: 'admin' }, userIdsToInvalidate: new Set() } as never)
    const res = await PATCH(patchReq({ role: 'admin' }), ctx({ id: PID, userId: 'u1' }))
    expect(res.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith(PID, 'owner-1', 'u1', 'admin')
  })

  it('forbidden→403', async () => {
    mockUpdate.mockResolvedValue({ error: 'forbidden' } as never)
    expect((await PATCH(patchReq({ role: 'admin' }), ctx({ id: PID, userId: 'u1' }))).status).toBe(403)
  })
})

describe('DELETE /api/projects/:id/members/:userId (remove member)', () => {
  const delReq = () => req('DELETE', '/api/projects/proj-1/members/u1')
  it('200 and evicts the removed user cache', async () => {
    mockRemove.mockResolvedValue({ removedUserId: 'u1', userIdsToInvalidate: new Set(['u1']) } as never)
    const res = await DELETE(delReq(), ctx({ id: PID, userId: 'u1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, removedUserId: 'u1' })
    expect(mockDel).toHaveBeenCalledWith('lists:user:u1')
  })

  it('invalid (owner removal)→400 and no eviction', async () => {
    mockRemove.mockResolvedValue({ error: 'invalid', message: 'The project owner cannot be removed' } as never)
    expect((await DELETE(delReq(), ctx({ id: PID, userId: 'owner-1' }))).status).toBe(400)
    expect(mockDel).not.toHaveBeenCalled()
  })

  it('member_not_found→404', async () => {
    mockRemove.mockResolvedValue({ error: 'member_not_found' } as never)
    expect((await DELETE(delReq(), ctx({ id: PID, userId: 'ghost' }))).status).toBe(404)
  })
})
