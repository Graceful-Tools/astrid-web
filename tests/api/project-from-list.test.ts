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
    keys: {
      userLists: (id: string) => `lists:user:${id}`,
      userListsV1: (id: string) => `lists:user:${id}:v1`,
    },
    invalidate: {
      userListsAllVersions: vi.fn().mockResolvedValue(undefined),
    },
  },
}))
// Project Mode is request-gated (task dd7172d8). Mocked so these cases cover
// route behavior; the gate's own logic is covered in tests/lib/project-mode.test.ts.
vi.mock('@/lib/project-mode', () => ({
  projectModeGate: vi.fn(),
  PROJECT_MODE_FEATURE_KEY: 'project_mode',
}))

import { NextResponse } from 'next/server'
import { POST } from '@/app/api/projects/from-list/route'
import { createProjectFromList } from '@/lib/projects-service'
import { getUnifiedSession } from '@/lib/session-utils'
import { RedisCache } from '@/lib/redis'
import { projectModeGate } from '@/lib/project-mode'

const mockCreate = vi.mocked(createProjectFromList)
const mockSession = vi.mocked(getUnifiedSession)
const mockInvalidate = vi.mocked(RedisCache.invalidate.userListsAllVersions)
const mockGate = vi.mocked(projectModeGate)

const req = (body?: unknown) =>
  new NextRequest('http://localhost/api/projects/from-list', {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  })

beforeEach(() => {
  vi.clearAllMocks()
  mockSession.mockResolvedValue({ user: { id: 'u1' } } as never)
  mockInvalidate.mockResolvedValue(undefined as never)
  mockGate.mockResolvedValue(null)
})

describe('Project Mode gate (dd7172d8)', () => {
  it('404s when the capability is compiled out, without creating anything', async () => {
    mockGate.mockResolvedValue(NextResponse.json({ error: 'Not found' }, { status: 404 }))
    const res = await POST(req({ listId: 'l1' }))
    expect(res.status).toBe(404)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('403s when the user has not been granted access, without creating anything', async () => {
    // The point of the gate: hiding the button is not enough, the route itself
    // must refuse, or an OAuth client walks straight past the opt-in.
    mockGate.mockResolvedValue(
      NextResponse.json({ error: 'nope', reason: 'not_granted' }, { status: 403 })
    )
    const res = await POST(req({ listId: 'l1' }))
    expect(res.status).toBe(403)
    expect((await res.json()).reason).toBe('not_granted')
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('runs the gate before reading the body, so an ungranted caller cannot probe validation', async () => {
    mockGate.mockResolvedValue(NextResponse.json({ error: 'Not found' }, { status: 404 }))
    // No listId at all: a 400 here would leak that the route exists and what it wants.
    expect((await POST(req({}))).status).toBe(404)
  })
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
  // Both cached list sets — the legacy key and the v1 key iOS reads — must go.
  // This used to assert a bare del('lists:user:u1'), which left iOS stale for
  // the rest of the 5-minute TTL (task 070bddf8).
  expect(mockInvalidate).toHaveBeenCalledWith('u1')
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
  expect(mockInvalidate).not.toHaveBeenCalled()
})
