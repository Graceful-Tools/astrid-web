/**
 * AWTD-1668 — the admin runtime-binding routes: admin only, changes only from a
 * human admin's browser session (never an agent's or script's token), and every
 * refusal answered with its code and explanation.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api-auth-middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-auth-middleware')>('@/lib/api-auth-middleware')
  return { ...actual, authenticateAPI: vi.fn() }
})
vi.mock('@/lib/runtime-binding/enrollment', async () => {
  const actual = await vi.importActual<typeof import('@/lib/runtime-binding/enrollment')>('@/lib/runtime-binding/enrollment')
  return {
    ...actual,
    listRuntimeBindings: vi.fn(),
    createRuntimeBinding: vi.fn(),
    updateRuntimeBinding: vi.fn(),
    transitionRuntimeBinding: vi.fn(),
    attachBoardToRuntimeBinding: vi.fn(),
    detachBoardFromRuntimeBinding: vi.fn(),
  }
})

import { authenticateAPI } from '@/lib/api-auth-middleware'
import {
  RuntimeBindingEnrollmentError,
  attachBoardToRuntimeBinding,
  createRuntimeBinding,
  detachBoardFromRuntimeBinding,
  listRuntimeBindings,
  transitionRuntimeBinding,
} from '@/lib/runtime-binding/enrollment'
import { GET as list, POST as create } from '@/app/api/v1/admin/runtime-bindings/route'
import { POST as lifecycle } from '@/app/api/v1/admin/runtime-bindings/[id]/lifecycle/route'
import { DELETE as detach, POST as attach } from '@/app/api/v1/admin/runtime-bindings/[id]/boards/route'

const ctx = { params: Promise.resolve({ id: 'binding-1' }) }

function as(source: 'session' | 'oauth' | 'legacy_mcp', isAIAgent = false) {
  vi.mocked(authenticateAPI).mockResolvedValue({
    userId: 'admin-1',
    source,
    scopes: ['*'],
    isAIAgent,
    user: { id: 'admin-1', email: 'admin@example.test', name: 'Admin', isAIAgent },
  } as never)
}

const post = (path: string, body: unknown) =>
  new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  vi.clearAllMocks()
  as('session')
})

describe('AWTD-1668 admin runtime-binding routes', () => {
  it('lists for an admin, including whether enrollment is enabled', async () => {
    vi.mocked(listRuntimeBindings).mockResolvedValue({ enrollmentEnabled: false, bindings: [] })
    const res = await list(new NextRequest('http://localhost/api/v1/admin/runtime-bindings'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ enrollmentEnabled: false, bindings: [] })
  })

  it('answers a non-admin with 403 admin-required', async () => {
    vi.mocked(listRuntimeBindings).mockRejectedValue(
      new RuntimeBindingEnrollmentError('admin-required', 'Runtime bindings are managed by deployment admins only.'),
    )
    const res = await list(new NextRequest('http://localhost/api/v1/admin/runtime-bindings'))
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'admin-required' })
  })

  it.each([
    ['an OAuth token', 'oauth' as const, false],
    ['an access token', 'legacy_mcp' as const, false],
    ['an agent session', 'session' as const, true],
  ])('refuses changes from %s', async (_label, source, agent) => {
    as(source, agent)
    const responses = await Promise.all([
      create(post('/api/v1/admin/runtime-bindings', {})),
      lifecycle(post('/api/v1/admin/runtime-bindings/binding-1/lifecycle', { action: 'approve' }), ctx),
      attach(post('/api/v1/admin/runtime-bindings/binding-1/boards', { boardId: 'board-1' }), ctx),
    ])
    for (const res of responses) {
      expect(res.status).toBe(403)
      expect(await res.json()).toMatchObject({ code: 'session-required' })
    }
    expect(createRuntimeBinding).not.toHaveBeenCalled()
    expect(transitionRuntimeBinding).not.toHaveBeenCalled()
    expect(attachBoardToRuntimeBinding).not.toHaveBeenCalled()
  })

  it('passes the deployment gate refusal through with its explanation', async () => {
    vi.mocked(createRuntimeBinding).mockRejectedValue(
      new RuntimeBindingEnrollmentError('deployment-not-single-business', 'Only on a dedicated single-business deployment.'),
    )
    const res = await create(post('/api/v1/admin/runtime-bindings', { managementScope: 'deployment-business' }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({
      error: 'Only on a dedicated single-business deployment.',
      code: 'deployment-not-single-business',
    })
  })

  it('rejects an unknown lifecycle action before reaching the service', async () => {
    const res = await lifecycle(post('/api/v1/admin/runtime-bindings/binding-1/lifecycle', { action: 'enable' }), ctx)
    expect(res.status).toBe(400)
    expect(transitionRuntimeBinding).not.toHaveBeenCalled()
  })

  it('runs a lifecycle action with the expected revision', async () => {
    vi.mocked(transitionRuntimeBinding).mockResolvedValue({ id: 'binding-1', state: 'verified' } as never)
    const res = await lifecycle(
      post('/api/v1/admin/runtime-bindings/binding-1/lifecycle', { action: 'verify', expectedRevision: 3 }),
      ctx,
    )
    expect(res.status).toBe(200)
    expect(transitionRuntimeBinding).toHaveBeenCalledWith({ userId: 'admin-1' }, 'binding-1', 'verify', 3)
  })

  it('a held attach conflict is a 409 that names the boards', async () => {
    vi.mocked(attachBoardToRuntimeBinding).mockRejectedValue(
      new RuntimeBindingEnrollmentError('board-conflict', 'Ops shares tasks with Billing.', {
        conflictingBoards: [{ id: 'board-2', name: 'Billing', runtimeBindingId: 'binding-9' }],
      }),
    )
    const res = await attach(post('/api/v1/admin/runtime-bindings/binding-1/boards', { boardId: 'board-1' }), ctx)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      code: 'board-conflict',
      details: { conflictingBoards: [{ id: 'board-2' }] },
    })
  })

  it('detaches by query parameter', async () => {
    vi.mocked(detachBoardFromRuntimeBinding).mockResolvedValue(undefined)
    const res = await detach(
      new NextRequest('http://localhost/api/v1/admin/runtime-bindings/binding-1/boards?boardId=board-1', { method: 'DELETE' }),
      ctx,
    )
    expect(res.status).toBe(200)
    expect(detachBoardFromRuntimeBinding).toHaveBeenCalledWith({ userId: 'admin-1' }, 'binding-1', 'board-1')
  })
})
