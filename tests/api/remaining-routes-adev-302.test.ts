/**
 * Route tests for the last three routes the ADEV-293 allowlist held (ADEV-302):
 * /api/coding-workflow/status/[taskId], /api/v1/contacts/recommended and
 * /api/mcp/sync.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { mockPrisma } from '../setup'
import { resetRouteHarness, signIn, callRoute, ensurePrismaModels } from '../utils/route-harness'
import { requireScopes, ForbiddenError } from '@/lib/api-auth-middleware'

vi.mock('@/lib/api-auth-middleware', async () => (await import('../utils/route-harness')).authMiddlewareMock())

const session = vi.hoisted(() => ({ getUnifiedSession: vi.fn() }))
vi.mock('@/lib/session-utils', () => ({ getUnifiedSession: session.getUnifiedSession }))

import { GET as workflowStatus } from '@/app/api/coding-workflow/status/[taskId]/route'
import { GET as recommended } from '@/app/api/v1/contacts/recommended/route'
import { POST as mcpSync } from '@/app/api/mcp/sync/route'

beforeEach(() => {
  resetRouteHarness()
  session.getUnifiedSession.mockReset()
  ensurePrismaModels({ addressBookContact: ['findMany'] })
})

describe('GET /api/coding-workflow/status/[taskId] (ADEV-302)', () => {
  const call = () =>
    workflowStatus(new NextRequest('http://localhost/api/coding-workflow/status/task-1'), {
      params: Promise.resolve({ taskId: 'task-1' }),
    } as never)

  const workflow = (status: string, creatorId = 'owner-1') => ({
    id: 'wf-1',
    taskId: 'task-1',
    status,
    aiService: 'claude',
    metadata: null,
    task: { id: 'task-1', creatorId, assigneeId: null, lists: [] },
  })

  it('401 without a session', async () => {
    session.getUnifiedSession.mockResolvedValue(null)
    expect((await call()).status).toBe(401)
  })

  it('404 when the task has no workflow', async () => {
    session.getUnifiedSession.mockResolvedValue({ user: { id: 'owner-1' } })
    mockPrisma.codingTaskWorkflow.findUnique.mockResolvedValue(null)
    expect((await call()).status).toBe(404)
  })

  it('403 for a user with no access to the task', async () => {
    session.getUnifiedSession.mockResolvedValue({ user: { id: 'stranger' } })
    mockPrisma.codingTaskWorkflow.findUnique.mockResolvedValue(workflow('PLANNING') as never)
    expect((await call()).status).toBe(403)
  })

  it('returns progress and flags for the task creator', async () => {
    session.getUnifiedSession.mockResolvedValue({ user: { id: 'owner-1' } })
    mockPrisma.codingTaskWorkflow.findUnique.mockResolvedValue(workflow('AWAITING_APPROVAL') as never)
    const res = await call()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.progress).toBe(40)
    expect(body.canApprove).toBe(true)
    expect(body.canMerge).toBe(false)
    expect(body.statusText).toBe('awaiting approval')
  })

  it('500 when the lookup throws', async () => {
    session.getUnifiedSession.mockResolvedValue({ user: { id: 'owner-1' } })
    mockPrisma.codingTaskWorkflow.findUnique.mockRejectedValue(new Error('db down'))
    expect((await call()).status).toBe(500)
  })
})

describe('GET /api/v1/contacts/recommended (ADEV-302)', () => {
  const get = (query = '') => callRoute(recommended as never, { path: `/api/v1/contacts/recommended${query}` })

  it('401 when signed out', async () => {
    expect((await get()).status).toBe(401)
  })

  it('403 without the contacts:read scope', async () => {
    signIn({ scopes: [] })
    vi.mocked(requireScopes).mockImplementation(() => {
      throw new ForbiddenError()
    })
    expect((await get()).status).toBe(403)
  })

  it('404 when the user row is gone', async () => {
    signIn({ scopes: ['contacts:read'] })
    mockPrisma.user.findUnique.mockResolvedValue(null)
    expect((await get()).status).toBe(404)
  })

  it('returns an empty list when no contacts were uploaded', async () => {
    signIn({ scopes: ['contacts:read'] })
    mockPrisma.user.findUnique.mockResolvedValue({ email: 'me@example.com' } as never)
    ;(mockPrisma as any).addressBookContact.findMany.mockResolvedValue([])
    const { status, body } = await get()
    expect(status).toBe(200)
    expect(body.recommended).toEqual([])
  })

  it('puts mutual contacts first', async () => {
    signIn({ userId: 'me', scopes: ['contacts:read'] })
    mockPrisma.user.findUnique.mockResolvedValue({ email: 'Me@example.com' } as never)
    const abc = (mockPrisma as any).addressBookContact.findMany
    abc.mockResolvedValueOnce([
      { email: 'a@example.com', name: null },
      { email: 'b@example.com', name: null },
    ])
    mockPrisma.user.findMany.mockResolvedValue([
      { id: 'ua', email: 'a@example.com', name: 'Alice', image: null },
      { id: 'ub', email: 'b@example.com', name: 'Bob', image: null },
    ] as never)
    abc.mockResolvedValueOnce([{ userId: 'ub' }])
    const { status, body } = await get('?limit=5')
    expect(status).toBe(200)
    expect(body.recommended.map((r: { id: string }) => r.id)).toEqual(['ub', 'ua'])
    expect(body.stats).toEqual({ mutual: 1, nonMutual: 1, total: 2 })
    expect(abc.mock.calls[1][0].where.email).toBe('me@example.com')
  })
})

describe('POST /api/mcp/sync (ADEV-302)', () => {
  const post = (body: unknown) => callRoute(mcpSync as never, { path: '/api/mcp/sync', method: 'POST', body })

  it('400 without an access token', async () => {
    expect((await post({})).status).toBe(400)
  })

  it('401 for an unknown or expired token', async () => {
    mockPrisma.mCPToken.findFirst.mockResolvedValue(null)
    expect((await post({ accessToken: 'nope' })).status).toBe(401)
    const where = mockPrisma.mCPToken.findFirst.mock.calls[0][0].where
    expect(where.isActive).toBe(true)
    expect(where.OR).toHaveLength(2)
  })

  it('returns created and updated rows since the checkpoint, scoped to visible lists', async () => {
    mockPrisma.mCPToken.findFirst.mockResolvedValue({ user: { id: 'user-1' } } as never)
    mockPrisma.taskList.findMany
      .mockResolvedValueOnce([{ id: 'l1' }] as never)
      .mockResolvedValueOnce([{ id: 'l1' }] as never)
      .mockResolvedValueOnce([] as never)
    mockPrisma.task.findMany.mockResolvedValueOnce([{ id: 't1' }] as never).mockResolvedValueOnce([] as never)
    const { status, body } = await post({ accessToken: 'tok', lastSyncTimestamp: '2026-01-01T00:00:00.000Z' })
    expect(status).toBe(200)
    expect(body.tasks.created).toEqual([{ id: 't1' }])
    expect(body.lists.created).toEqual([{ id: 'l1' }])
    expect(body.stats).toMatchObject({ listsCreated: 1, tasksCreated: 1, tasksUpdated: 0 })
    const taskWhere = mockPrisma.task.findMany.mock.calls[0][0].where
    expect(taskWhere.lists.some.id.in).toEqual(['l1'])
  })

  it('500 when a query throws', async () => {
    mockPrisma.mCPToken.findFirst.mockRejectedValue(new Error('db down'))
    expect((await post({ accessToken: 'tok' })).status).toBe(500)
  })
})
