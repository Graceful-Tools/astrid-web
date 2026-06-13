/**
 * Route-level tests for the project member management endpoints
 * (board #3 write side):
 *   POST   /api/projects/:id/members
 *   PATCH  /api/projects/:id/members/:userId
 *   DELETE /api/projects/:id/members/:userId
 *
 * The projects-service layer is mocked — these focus on auth wiring, status
 * mapping, and that the returned userIdsToInvalidate are evicted from Redis.
 * Service behaviour (permission model, owner-immutability) is covered by
 * tests/lib/projects-service.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/projects-service', () => ({
  addProjectMember: vi.fn(),
  removeProjectMember: vi.fn(),
  updateProjectMemberRole: vi.fn(),
}))

vi.mock('@/lib/session-utils', () => ({
  getUnifiedSession: vi.fn(),
}))

vi.mock('@/lib/redis', () => ({
  RedisCache: {
    del: vi.fn().mockResolvedValue(undefined),
    keys: { userLists: (id: string) => `lists:user:${id}` },
  },
}))

import { POST } from '@/app/api/projects/[id]/members/route'
import { PATCH, DELETE } from '@/app/api/projects/[id]/members/[userId]/route'
import { addProjectMember, removeProjectMember, updateProjectMemberRole } from '@/lib/projects-service'
import { getUnifiedSession } from '@/lib/session-utils'
import { RedisCache } from '@/lib/redis'

const mockAdd = vi.mocked(addProjectMember)
const mockRemove = vi.mocked(removeProjectMember)
const mockUpdate = vi.mocked(updateProjectMemberRole)
const mockSession = vi.mocked(getUnifiedSession)
const mockDel = vi.mocked(RedisCache.del)

const PID = 'proj-1'
const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) })
const postReq = (body: unknown) =>
  new NextRequest('http://localhost/api/projects/proj-1/members', {
    method: 'POST',
    body: JSON.stringify(body),
  })
const patchReq = (body: unknown) =>
  new NextRequest('http://localhost/api/projects/proj-1/members/u1', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
const delReq = () =>
  new NextRequest('http://localhost/api/projects/proj-1/members/u1', { method: 'DELETE' })

beforeEach(() => {
  vi.clearAllMocks()
  mockSession.mockResolvedValue({ user: { id: 'owner-1' } } as never)
  mockDel.mockResolvedValue(undefined as never)
})

describe('POST /api/projects/:id/members', () => {
  it('401 when unauthenticated', async () => {
    mockSession.mockResolvedValue(null as never)
    const res = await POST(postReq({ email: 't@x.com' }), ctx({ id: PID }))
    expect(res.status).toBe(401)
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('201 with the new member and evicts the returned user caches', async () => {
    mockAdd.mockResolvedValue({
      member: { id: 'u1', name: 'T', email: 't@x.com', image: null, role: 'member' },
      userIdsToInvalidate: new Set(['u1']),
    } as never)
    const res = await POST(postReq({ email: 't@x.com', role: 'member' }), ctx({ id: PID }))
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ member: { id: 'u1', name: 'T', email: 't@x.com', image: null, role: 'member' } })
    expect(mockDel).toHaveBeenCalledWith('lists:user:u1')
  })

  it('maps not_found→404, forbidden→403, user_not_found→404, invalid→400', async () => {
    mockAdd.mockResolvedValueOnce({ error: 'not_found' } as never)
    expect((await POST(postReq({ email: 'a' }), ctx({ id: PID }))).status).toBe(404)
    mockAdd.mockResolvedValueOnce({ error: 'forbidden' } as never)
    expect((await POST(postReq({ email: 'a' }), ctx({ id: PID }))).status).toBe(403)
    mockAdd.mockResolvedValueOnce({ error: 'user_not_found' } as never)
    expect((await POST(postReq({ email: 'a' }), ctx({ id: PID }))).status).toBe(404)
    mockAdd.mockResolvedValueOnce({ error: 'invalid', message: 'bad' } as never)
    const res = await POST(postReq({ email: 'a' }), ctx({ id: PID }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('bad')
    expect(mockDel).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/projects/:id/members/:userId', () => {
  it('401 when unauthenticated', async () => {
    mockSession.mockResolvedValue(null as never)
    expect((await PATCH(patchReq({ role: 'admin' }), ctx({ id: PID, userId: 'u1' }))).status).toBe(401)
  })

  it('200 and returns the updated member', async () => {
    mockUpdate.mockResolvedValue({
      member: { id: 'u1', role: 'admin' },
      userIdsToInvalidate: new Set(),
    } as never)
    const res = await PATCH(patchReq({ role: 'admin' }), ctx({ id: PID, userId: 'u1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ member: { id: 'u1', role: 'admin' } })
    expect(mockUpdate).toHaveBeenCalledWith(PID, 'owner-1', 'u1', 'admin')
  })

  it('forbidden→403 (only owner changes roles)', async () => {
    mockUpdate.mockResolvedValue({ error: 'forbidden' } as never)
    expect((await PATCH(patchReq({ role: 'admin' }), ctx({ id: PID, userId: 'u1' }))).status).toBe(403)
  })
})

describe('DELETE /api/projects/:id/members/:userId', () => {
  it('200 and evicts the removed user cache', async () => {
    mockRemove.mockResolvedValue({
      removedUserId: 'u1',
      userIdsToInvalidate: new Set(['u1']),
    } as never)
    const res = await DELETE(delReq(), ctx({ id: PID, userId: 'u1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, removedUserId: 'u1' })
    expect(mockDel).toHaveBeenCalledWith('lists:user:u1')
    expect(mockRemove).toHaveBeenCalledWith(PID, 'owner-1', 'u1')
  })

  it('invalid (owner removal)→400 and no eviction', async () => {
    mockRemove.mockResolvedValue({ error: 'invalid', message: 'The project owner cannot be removed' } as never)
    const res = await DELETE(delReq(), ctx({ id: PID, userId: 'owner-1' }))
    expect(res.status).toBe(400)
    expect(mockDel).not.toHaveBeenCalled()
  })

  it('member_not_found→404', async () => {
    mockRemove.mockResolvedValue({ error: 'member_not_found' } as never)
    expect((await DELETE(delReq(), ctx({ id: PID, userId: 'ghost' }))).status).toBe(404)
  })
})
