/**
 * Route tests for POST /api/projects/from-list — the atomic create-board
 * endpoint (create project + attach list in one transaction). Service is
 * mocked; these cover auth, validation, error mapping, and cache eviction.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/projects-service', () => ({
  createProjectFromList: vi.fn(),
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

import { POST } from '@/app/api/projects/from-list/route'
import { createProjectFromList } from '@/lib/projects-service'
import { getUnifiedSession } from '@/lib/session-utils'
import { RedisCache } from '@/lib/redis'

const mockCreate = vi.mocked(createProjectFromList)
const mockSession = vi.mocked(getUnifiedSession)
const mockDel = vi.mocked(RedisCache.del)

const req = (body?: unknown) =>
  new NextRequest('http://localhost/api/projects/from-list', {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  })

beforeEach(() => {
  vi.clearAllMocks()
  mockSession.mockResolvedValue({ user: { id: 'u1' } } as never)
  mockDel.mockResolvedValue(undefined as never)
})

it('401 when unauthenticated', async () => {
  mockSession.mockResolvedValue(null as never)
  expect((await POST(req({ listId: 'l1' }))).status).toBe(401)
})

it('400 when listId missing', async () => {
  expect((await POST(req({}))).status).toBe(400)
})

it('201 with project + list and evicts cache', async () => {
  mockCreate.mockResolvedValue({ project: { id: 'p1', lists: [] }, list: { id: 'l1', projectId: 'p1' } } as never)
  const res = await POST(req({ listId: 'l1' }))
  expect(res.status).toBe(201)
  const body = await res.json()
  expect(body.project.id).toBe('p1')
  expect(body.list.projectId).toBe('p1')
  expect(mockDel).toHaveBeenCalledWith('lists:user:u1')
  expect(mockCreate).toHaveBeenCalledWith('u1', 'l1')
})

it('maps service errors: list_not_found→404, forbidden→403, invalid→400', async () => {
  mockCreate.mockResolvedValueOnce({ error: 'list_not_found' } as never)
  expect((await POST(req({ listId: 'l1' }))).status).toBe(404)
  mockCreate.mockResolvedValueOnce({ error: 'forbidden' } as never)
  expect((await POST(req({ listId: 'l1' }))).status).toBe(403)
  mockCreate.mockResolvedValueOnce({ error: 'invalid', message: 'already a board' } as never)
  const res = await POST(req({ listId: 'l1' }))
  expect(res.status).toBe(400)
  expect((await res.json()).error).toBe('already a board')
  expect(mockDel).not.toHaveBeenCalled()
})
