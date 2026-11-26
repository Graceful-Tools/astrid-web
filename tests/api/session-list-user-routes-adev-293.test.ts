// @vitest-environment node
/**
 * Route tests for session-based and user routes no test referenced (ADEV-293):
 * POST /api/lists/restore-defaults, POST /api/lists/upload-image,
 * GET /api/lists/:id/preview, GET /api/users/:id/is-coding-agent,
 * GET /api/contacts/google/authorize, GET /api/v1/users/me/available-models.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  authenticateAPI: vi.fn(),
  requireScopes: vi.fn(),
  getUnifiedSession: vi.fn(),
  deleteLists: vi.fn(),
  listCreate: vi.fn(),
  listUpdate: vi.fn(),
  userFindUnique: vi.fn(),
  toggleFavorite: vi.fn(),
  writeFile: vi.fn(),
  getPublicListPreview: vi.fn(),
  getAIServiceCredential: vi.fn(),
  fetchProviderModels: vi.fn(),
}))

vi.mock('@/lib/api-auth-middleware', () => {
  class UnauthorizedError extends Error {
    constructor(msg = 'Unauthorized') { super(msg); this.name = 'UnauthorizedError' }
  }
  class ForbiddenError extends Error {
    constructor(msg = 'Forbidden') { super(msg); this.name = 'ForbiddenError' }
  }
  return {
    authenticateAPI: m.authenticateAPI,
    requireScopes: m.requireScopes,
    getDeprecationWarning: vi.fn(() => null),
    UnauthorizedError,
    ForbiddenError,
  }
})
vi.mock('@/lib/session-utils', () => ({ getUnifiedSession: m.getUnifiedSession }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: { create: m.listCreate, update: m.listUpdate },
    user: { findUnique: m.userFindUnique },
  },
}))
vi.mock('@/lib/images/update-list-image', () => ({ deleteListsWithImageRelease: m.deleteLists }))
vi.mock('@/lib/favorites', () => ({ toggleFavorite: m.toggleFavorite }))
vi.mock('fs/promises', () => ({ writeFile: m.writeFile, default: { writeFile: m.writeFile } }))
vi.mock('@/lib/copy-utils', () => ({ getPublicListPreview: m.getPublicListPreview }))
vi.mock('@/lib/api-key-cache', () => ({ getAIServiceCredential: m.getAIServiceCredential }))
vi.mock('@/lib/ai/fetch-provider-models', () => ({ fetchProviderModels: m.fetchProviderModels }))

import { POST as restoreDefaults } from '@/app/api/lists/restore-defaults/route'
import { POST as uploadImage } from '@/app/api/lists/upload-image/route'
import { GET as preview } from '@/app/api/lists/[id]/preview/route'
import { GET as isCodingAgentRoute } from '@/app/api/users/[userId]/is-coding-agent/route'
import { GET as googleAuthorize } from '@/app/api/contacts/google/authorize/route'
import { GET as availableModels } from '@/app/api/v1/users/me/available-models/route'
import { UnauthorizedError } from '@/lib/api-auth-middleware'

const session = { user: { id: 'user-1', email: 'jon@example.com' } }
const req = (url: string, init?: RequestInit) => new NextRequest(`http://localhost${url}`, init as never)
const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) }) as never

beforeEach(() => {
  vi.clearAllMocks()
  m.getUnifiedSession.mockResolvedValue(session)
})

describe('POST /api/lists/restore-defaults (ADEV-293)', () => {
  it('401 without a session, and nothing is deleted or created', async () => {
    m.getUnifiedSession.mockResolvedValue(null)
    expect((await restoreDefaults(req('/api/lists/restore-defaults', { method: 'POST' }))).status).toBe(401)
    expect(m.deleteLists).not.toHaveBeenCalled()
    expect(m.listCreate).not.toHaveBeenCalled()
  })

  it("replaces only the caller's default saved filters and favorites the three new ones", async () => {
    let n = 0
    m.listCreate.mockImplementation(async ({ data }) => ({ id: `list-${++n}`, ...data }))
    const res = await restoreDefaults(req('/api/lists/restore-defaults', { method: 'POST' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, count: 3 })
    expect(m.deleteLists).toHaveBeenCalledWith(expect.objectContaining({ ownerId: 'user-1', isVirtual: true }))
    expect(m.listCreate.mock.calls.map(c => c[0].data.virtualListType)).toEqual(['today', 'not-in-list', 'assigned'])
    expect(m.listCreate.mock.calls.every(c => c[0].data.ownerId === 'user-1')).toBe(true)
    expect(m.toggleFavorite).toHaveBeenCalledTimes(3)
    expect(m.toggleFavorite).toHaveBeenCalledWith('user-1', 'list-1', true)
  })

  it('500 when the write fails', async () => {
    m.listCreate.mockRejectedValue(new Error('db down'))
    expect((await restoreDefaults(req('/api/lists/restore-defaults', { method: 'POST' }))).status).toBe(500)
  })
})

describe('POST /api/lists/upload-image (ADEV-293)', () => {
  const post = (form: FormData) => uploadImage(req('/api/lists/upload-image', { method: 'POST', body: form }))
  const png = () => new File([new Uint8Array([137, 80, 78, 71])], 'pic.png', { type: 'image/png' })

  it('401 without a session', async () => {
    m.getUnifiedSession.mockResolvedValue(null)
    expect((await post(new FormData())).status).toBe(401)
    expect(m.writeFile).not.toHaveBeenCalled()
  })

  it('400 with no file, and for a file type that is not an image', async () => {
    expect((await post(new FormData())).status).toBe(400)
    const form = new FormData()
    form.set('file', new File(['#!/bin/sh'], 'evil.sh', { type: 'text/x-sh' }))
    expect((await post(form)).status).toBe(400)
    expect(m.writeFile).not.toHaveBeenCalled()
  })

  it('stores a valid image under a generated name, never the uploaded one', async () => {
    const form = new FormData()
    form.set('file', png())
    const res = await post(form)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.imageUrl).toMatch(/^\/uploads\/\d+-[0-9a-f]{16}\.png$/)
    expect(body.imageUrl).not.toContain('pic')
    expect(m.writeFile).toHaveBeenCalledTimes(1)
  })
})

describe('GET /api/lists/:id/preview (ADEV-293)', () => {
  const call = () => preview(req('/api/lists/l1/preview'), ctx({ id: 'l1' }))

  it('401 without a session', async () => {
    m.getUnifiedSession.mockResolvedValue(null)
    expect((await call()).status).toBe(401)
    expect(m.getPublicListPreview).not.toHaveBeenCalled()
  })

  it('404 when the list is not a public list', async () => {
    m.getPublicListPreview.mockResolvedValue(null)
    expect((await call()).status).toBe(404)
  })

  it('returns the preview', async () => {
    m.getPublicListPreview.mockResolvedValue({ id: 'l1', name: 'Public' })
    const res = await call()
    expect(await res.json()).toEqual({ success: true, list: { id: 'l1', name: 'Public' } })
  })
})

describe('GET /api/users/:userId/is-coding-agent (ADEV-293)', () => {
  const call = () => isCodingAgentRoute(req('/api/users/u2/is-coding-agent'), ctx({ userId: 'u2' }))

  it('401 without a session', async () => {
    m.getUnifiedSession.mockResolvedValue(null)
    expect((await call()).status).toBe(401)
    expect(m.userFindUnique).not.toHaveBeenCalled()
  })

  it('404 for an unknown user', async () => {
    m.userFindUnique.mockResolvedValue(null)
    expect((await call()).status).toBe(404)
  })

  it('a human is not a coding agent, and an inactive one is not either', async () => {
    m.userFindUnique.mockResolvedValue({ id: 'u2', isAIAgent: false, aiAgentType: null, isActive: true })
    expect((await (await call()).json()).isCodingAgent).toBe(false)
    m.userFindUnique.mockResolvedValue({ id: 'u2', isAIAgent: true, aiAgentType: 'coding_agent', isActive: false })
    expect((await (await call()).json()).isCodingAgent).toBe(false)
  })
})

describe('GET /api/contacts/google/authorize (ADEV-293)', () => {
  const original = process.env.GOOGLE_CLIENT_ID
  afterEach(() => {
    if (original === undefined) delete process.env.GOOGLE_CLIENT_ID
    else process.env.GOOGLE_CLIENT_ID = original
  })

  it('sends a signed-out caller to sign-in', async () => {
    m.getUnifiedSession.mockResolvedValue(null)
    const res = await googleAuthorize(req('/api/contacts/google/authorize'))
    expect(res.headers.get('location')).toContain('/auth/signin')
  })

  it('reports a missing client id as an error redirect, not a Google URL', async () => {
    delete process.env.GOOGLE_CLIENT_ID
    const res = await googleAuthorize(req('/api/contacts/google/authorize'))
    expect(res.headers.get('location')).toContain('/settings/contacts?google=error')
  })

  it('redirects to Google with a state that is also set as an httpOnly cookie', async () => {
    process.env.GOOGLE_CLIENT_ID = 'client-123'
    const res = await googleAuthorize(req('/api/contacts/google/authorize'))
    const location = new URL(res.headers.get('location')!)
    expect(location.origin).toBe('https://accounts.google.com')
    expect(location.searchParams.get('client_id')).toBe('client-123')
    const state = location.searchParams.get('state')
    expect(state).toMatch(/^[0-9a-f]{64}$/)
    const cookie = res.cookies.get('google_contacts_state')
    expect(cookie?.value).toBe(state)
    expect(cookie?.httpOnly).toBe(true)
  })
})

describe('GET /api/v1/users/me/available-models (ADEV-293)', () => {
  const auth = { userId: 'user-1', source: 'oauth' as const, scopes: ['*'], isAIAgent: false, user: { id: 'user-1' } }
  const call = (query: string) => availableModels(req(`/api/v1/users/me/available-models${query}`), undefined as never)

  beforeEach(() => {
    m.authenticateAPI.mockResolvedValue(auth)
    m.requireScopes.mockReturnValue(undefined)
  })

  it('401 when unauthenticated', async () => {
    m.authenticateAPI.mockRejectedValue(new UnauthorizedError())
    expect((await call('?service=claude')).status).toBe(401)
  })

  it('400 for a missing or unknown service', async () => {
    expect((await call('')).status).toBe(400)
    expect((await call('?service=bogus')).status).toBe(400)
    expect(m.getAIServiceCredential).not.toHaveBeenCalled()
  })

  it('falls back to the static suggestions without a stored key', async () => {
    m.getAIServiceCredential.mockResolvedValue(null)
    const body = await (await call('?service=claude')).json()
    expect(body.source).toBe('static')
    expect(m.fetchProviderModels).not.toHaveBeenCalled()
  })

  it("uses the provider's live list when the user has a key, and falls back when it is empty", async () => {
    m.getAIServiceCredential.mockResolvedValue('sk-key')
    m.fetchProviderModels.mockResolvedValue([{ id: 'live-1' }])
    const live = await (await call('?service=openai')).json()
    expect(live).toMatchObject({ source: 'live', models: [{ id: 'live-1' }] })
    m.fetchProviderModels.mockResolvedValue([])
    expect((await (await call('?service=openai')).json()).source).toBe('static')
  })
})
