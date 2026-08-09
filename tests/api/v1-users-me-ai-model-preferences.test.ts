/**
 * /api/v1/users/me/ai-model-preferences (task 641a7615, decision 3A)
 *
 * The sixth gap. My earlier count of five was wrong: the audit paired legacy
 * routes to v1 by name, and `/api/user/ai-model-preferences` looked covered by
 * `/api/v1/users/me/ai-preferences`. It is not — ai-preferences holds
 * `preferredService` and `defaultAgentId`, a different resource entirely. The
 * per-service model choice had no successor at all.
 *
 * What is worth pinning here is the read-modify-write on `mcpSettings`. That
 * one JSON column also holds the encrypted API keys, so an update that rebuilds
 * the blob from a stale read wipes the keys. Every write has to merge into the
 * settings it just read and preserve the untouched siblings.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: vi.fn(), update: vi.fn() } },
}))

vi.mock('@/lib/api-auth-middleware', () => {
  class UnauthorizedError extends Error {
    constructor(msg = 'Unauthorized') { super(msg); this.name = 'UnauthorizedError' }
  }
  class ForbiddenError extends Error {
    constructor(msg = 'Forbidden') { super(msg); this.name = 'ForbiddenError' }
  }
  return {
    authenticateAPI: vi.fn(), requireScopes: vi.fn(),
    UnauthorizedError, ForbiddenError, getDeprecationWarning: vi.fn(() => null),
  }
})

import { GET, PUT, DELETE } from '@/app/api/v1/users/me/ai-model-preferences/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI } from '@/lib/api-auth-middleware'
import { DEFAULT_MODELS } from '@/lib/ai/agent-config'

const mockPrisma = vi.mocked(prisma)
const mockAuth = vi.mocked(authenticateAPI)

const req = (method: string, body?: unknown) =>
  new NextRequest('http://localhost/api/v1/users/me/ai-model-preferences', {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
  })

/** The shared blob: model preferences sit next to the encrypted API keys. */
const settingsWith = (modelPreferences: Record<string, string>) =>
  JSON.stringify({ apiKeys: { claude: { encrypted: 'ciphertext' } }, modelPreferences })

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ userId: 'u1', source: 'session', scopes: ['*'], clientId: null } as never)
  mockPrisma.user.update.mockResolvedValue({} as never)
})

describe('GET /api/v1/users/me/ai-model-preferences (task 641a7615)', () => {
  it('reports a stored choice as not-default', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      mcpSettings: settingsWith({ claude: 'claude-opus-5' }),
    } as never)

    const body = await (await GET(req('GET'))).json()

    expect(body.preferences.claude).toMatchObject({ model: 'claude-opus-5', isDefault: false })
    expect(body.meta).toMatchObject({ apiVersion: 'v1' })
  })

  it('fills in the default model for a service the user never set', async () => {
    // The UI renders one input per service and needs a value for each, so an
    // unset service must come back populated rather than absent.
    mockPrisma.user.findUnique.mockResolvedValue({ mcpSettings: settingsWith({}) } as never)

    const body = await (await GET(req('GET'))).json()

    expect(body.preferences.openai).toMatchObject({
      model: DEFAULT_MODELS.openai,
      isDefault: true,
    })
  })

  it('returns the defaults and suggestions the picker is built from', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ mcpSettings: null } as never)

    const body = await (await GET(req('GET'))).json()

    expect(body.defaults).toBeDefined()
    expect(body.suggestions).toBeDefined()
  })

  it('survives an unparseable settings blob instead of 500ing', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ mcpSettings: '{not json' } as never)

    const response = await GET(req('GET'))

    expect(response.status).toBe(200)
  })
})

describe('PUT /api/v1/users/me/ai-model-preferences (task 641a7615)', () => {
  beforeEach(() => {
    mockPrisma.user.findUnique.mockResolvedValue({
      mcpSettings: settingsWith({ openai: 'gpt-x' }),
    } as never)
  })

  it('stores the model for the named service', async () => {
    const response = await PUT(req('PUT', { serviceId: 'claude', model: 'claude-opus-5' }))

    expect(response.status).toBe(200)
    const call = mockPrisma.user.update.mock.calls[0][0] as never as { data: { mcpSettings: string } }
    expect(JSON.parse(call.data.mcpSettings).modelPreferences.claude).toBe('claude-opus-5')
  })

  it('preserves the API keys stored in the same blob', async () => {
    // mcpSettings is one JSON column. Writing back only the model preferences
    // would delete the user's encrypted API keys as a side effect.
    await PUT(req('PUT', { serviceId: 'claude', model: 'claude-opus-5' }))

    const call = mockPrisma.user.update.mock.calls[0][0] as never as { data: { mcpSettings: string } }
    expect(JSON.parse(call.data.mcpSettings).apiKeys.claude.encrypted).toBe('ciphertext')
  })

  it('leaves other services alone', async () => {
    await PUT(req('PUT', { serviceId: 'claude', model: 'claude-opus-5' }))

    const call = mockPrisma.user.update.mock.calls[0][0] as never as { data: { mcpSettings: string } }
    expect(JSON.parse(call.data.mcpSettings).modelPreferences.openai).toBe('gpt-x')
  })

  it('rejects a service it does not know', async () => {
    const response = await PUT(req('PUT', { serviceId: 'skynet', model: 'x' }))

    expect(response.status).toBe(400)
    expect(mockPrisma.user.update).not.toHaveBeenCalled()
  })

  it('rejects an empty model name', async () => {
    const response = await PUT(req('PUT', { serviceId: 'claude', model: '' }))

    expect(response.status).toBe(400)
  })
})

describe('DELETE /api/v1/users/me/ai-model-preferences (task 641a7615)', () => {
  beforeEach(() => {
    mockPrisma.user.findUnique.mockResolvedValue({
      mcpSettings: settingsWith({ claude: 'claude-opus-5', openai: 'gpt-x' }),
    } as never)
  })

  it('removes the override so the service falls back to the default', async () => {
    // Reset means "forget my choice", not "store the current default" — storing
    // it would freeze the user on today's model forever.
    const body = await (await DELETE(req('DELETE', { serviceId: 'claude' }))).json()

    const call = mockPrisma.user.update.mock.calls[0][0] as never as { data: { mcpSettings: string } }
    expect(JSON.parse(call.data.mcpSettings).modelPreferences.claude).toBeUndefined()
    expect(body).toMatchObject({ model: DEFAULT_MODELS.claude, isDefault: true })
  })

  it('preserves the API keys and the other services', async () => {
    await DELETE(req('DELETE', { serviceId: 'claude' }))

    const written = JSON.parse(
      (mockPrisma.user.update.mock.calls[0][0] as never as { data: { mcpSettings: string } }).data.mcpSettings
    )
    expect(written.apiKeys.claude.encrypted).toBe('ciphertext')
    expect(written.modelPreferences.openai).toBe('gpt-x')
  })

  it('rejects a service it does not know', async () => {
    const response = await DELETE(req('DELETE', { serviceId: 'skynet' }))

    expect(response.status).toBe(400)
    expect(mockPrisma.user.update).not.toHaveBeenCalled()
  })
})
