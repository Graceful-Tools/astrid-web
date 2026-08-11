/**
 * /api/v1/users/me/webhook-settings (task 641a7615, decision 3A)
 *
 * Fourth of the five legacy `/api/user/*` endpoints with no v1 successor, and
 * the one where "port it to v1" is not the whole answer.
 *
 * v1 exists so OAuth tokens can reach a surface. This surface should NOT be
 * reachable that way: configuring a webhook says "post every task assignment
 * and comment I receive to this URL", and the test-fire makes the server fetch
 * a URL the caller picked. A leaked narrow-scope token that could set it would
 * be a self-service exfiltration channel plus an SSRF trigger, so the writes
 * are session-only — the same stance `/api/v1/oauth/clients` already takes on
 * client registration.
 *
 * GET is the exception: it never returns the secret, so any authenticated
 * caller may read the configuration.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    userWebhookConfig: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock('@/lib/field-encryption', () => ({
  encryptField: vi.fn((v: string) => `enc:${v}`),
  decryptField: vi.fn((v: string) => String(v).replace(/^enc:/, '')),
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

import { GET, PUT, DELETE, POST } from '@/app/api/v1/users/me/webhook-settings/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI } from '@/lib/api-auth-middleware'

const mockPrisma = vi.mocked(prisma)
const mockAuth = vi.mocked(authenticateAPI)

const req = (method: string, body?: unknown) =>
  new NextRequest('http://localhost/api/v1/users/me/webhook-settings', {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
  })

const session = () =>
  mockAuth.mockResolvedValue({ userId: 'u1', source: 'session', scopes: ['*'], clientId: null } as never)
const oauth = () =>
  mockAuth.mockResolvedValue({ userId: 'u1', source: 'oauth', scopes: ['*'], clientId: 'c1' } as never)

const storedConfig = {
  id: 'w1',
  userId: 'u1',
  webhookUrl: 'enc:https://hooks.example.com/x',
  webhookSecret: 'enc:s3cr3t',
  enabled: true,
  events: ['task.assigned'],
  agents: ['claude'],
  failureCount: 0,
  maxRetries: 3,
  lastFiredAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
}

beforeEach(() => {
  vi.clearAllMocks()
  session()
})

describe('GET /api/v1/users/me/webhook-settings (task 641a7615)', () => {
  it('never returns the signing secret, only whether one exists', async () => {
    // The secret authenticates every delivery. Echoing it back on a read would
    // let anyone who can read the settings forge events to the user's server.
    mockPrisma.userWebhookConfig.findUnique.mockResolvedValue(storedConfig as never)

    const body = await (await GET(req('GET'))).json()

    expect(body.hasSecret).toBe(true)
    expect(JSON.stringify(body)).not.toContain('s3cr3t')
    expect(body.meta).toMatchObject({ apiVersion: 'v1' })
  })

  it('decrypts the stored url for display', async () => {
    mockPrisma.userWebhookConfig.findUnique.mockResolvedValue(storedConfig as never)

    const body = await (await GET(req('GET'))).json()

    expect(body.webhookUrl).toBe('https://hooks.example.com/x')
  })

  it('reports "not configured" plus the available options rather than 404', async () => {
    // The settings UI renders the event/agent pickers from this response, so an
    // unconfigured user still needs the option lists.
    mockPrisma.userWebhookConfig.findUnique.mockResolvedValue(null as never)

    const body = await (await GET(req('GET'))).json()

    expect(body.configured).toBe(false)
    expect(body.availableEvents).toContain('task.assigned')
    expect(body.availableAgents).toContain('claude')
  })

  it('is readable by an OAuth caller, since it exposes no secret', async () => {
    oauth()
    mockPrisma.userWebhookConfig.findUnique.mockResolvedValue(storedConfig as never)

    expect((await GET(req('GET'))).status).toBe(200)
  })
})

describe('PUT /api/v1/users/me/webhook-settings (task 641a7615)', () => {
  it('refuses to configure a webhook from an OAuth token', async () => {
    // Setting the URL is "forward all my task events here". A leaked token that
    // could do it would be a self-service exfiltration channel.
    oauth()

    const response = await PUT(req('PUT', { webhookUrl: 'https://evil.example.com/x' }))

    expect(response.status).toBe(403)
    expect(mockPrisma.userWebhookConfig.upsert).not.toHaveBeenCalled()
  })

  it('returns the secret exactly once, on creation', async () => {
    mockPrisma.userWebhookConfig.findUnique.mockResolvedValue(null as never)
    mockPrisma.userWebhookConfig.upsert.mockResolvedValue(storedConfig as never)

    const body = await (await PUT(req('PUT', { webhookUrl: 'https://hooks.example.com/x' }))).json()

    expect(typeof body.webhookSecret).toBe('string')
    expect(body.webhookSecret.length).toBeGreaterThan(0)
  })

  it('does not re-issue the secret on an ordinary update', async () => {
    // Re-sending it on every save would spread it through logs and caches for
    // no benefit — the user already saved it at creation.
    mockPrisma.userWebhookConfig.findUnique.mockResolvedValue(storedConfig as never)
    mockPrisma.userWebhookConfig.upsert.mockResolvedValue(storedConfig as never)

    const body = await (await PUT(req('PUT', { webhookUrl: 'https://hooks.example.com/x', enabled: false }))).json()

    expect(body.webhookSecret).toBeUndefined()
  })

  it('issues a new secret when asked to regenerate', async () => {
    mockPrisma.userWebhookConfig.findUnique.mockResolvedValue(storedConfig as never)
    mockPrisma.userWebhookConfig.upsert.mockResolvedValue(storedConfig as never)

    const body = await (await PUT(req('PUT', {
      webhookUrl: 'https://hooks.example.com/x',
      regenerateSecret: true,
    }))).json()

    expect(typeof body.webhookSecret).toBe('string')
    expect(body.secretRegenerated).toBe(true)
  })

  it('encrypts the url and the secret at rest', async () => {
    mockPrisma.userWebhookConfig.findUnique.mockResolvedValue(null as never)
    mockPrisma.userWebhookConfig.upsert.mockResolvedValue(storedConfig as never)

    await PUT(req('PUT', { webhookUrl: 'https://hooks.example.com/x' }))

    const call = mockPrisma.userWebhookConfig.upsert.mock.calls[0][0] as never as {
      create: { webhookUrl: string; webhookSecret: string }
    }
    expect(call.create.webhookUrl.startsWith('enc:')).toBe(true)
    expect(call.create.webhookSecret.startsWith('enc:')).toBe(true)
  })

  it('rejects a url that is not a url', async () => {
    const response = await PUT(req('PUT', { webhookUrl: 'not-a-url' }))

    expect(response.status).toBe(400)
    expect(mockPrisma.userWebhookConfig.upsert).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/v1/users/me/webhook-settings (task 641a7615)', () => {
  it('refuses from an OAuth token', async () => {
    oauth()

    const response = await DELETE(req('DELETE'))

    expect(response.status).toBe(403)
    expect(mockPrisma.userWebhookConfig.delete).not.toHaveBeenCalled()
  })

  it('removes the configuration for the caller', async () => {
    mockPrisma.userWebhookConfig.findUnique.mockResolvedValue(storedConfig as never)
    mockPrisma.userWebhookConfig.delete.mockResolvedValue(storedConfig as never)

    const response = await DELETE(req('DELETE'))

    expect(response.status).toBe(200)
    expect(mockPrisma.userWebhookConfig.delete).toHaveBeenCalledWith({ where: { userId: 'u1' } })
  })

  it('404s when there is nothing configured', async () => {
    mockPrisma.userWebhookConfig.findUnique.mockResolvedValue(null as never)

    expect((await DELETE(req('DELETE'))).status).toBe(404)
  })
})

describe('POST /api/v1/users/me/webhook-settings (task 641a7615)', () => {
  it('refuses to test-fire from an OAuth token', async () => {
    // The test-fire makes the server issue an outbound request to a stored URL.
    // Triggering that is a session-only capability for the same reason setting
    // the URL is.
    oauth()

    const response = await POST(req('POST'))

    expect(response.status).toBe(403)
  })

  it('404s when nothing is configured to test', async () => {
    mockPrisma.userWebhookConfig.findUnique.mockResolvedValue(null as never)

    expect((await POST(req('POST'))).status).toBe(404)
  })

  it('refuses to fire a disabled webhook', async () => {
    mockPrisma.userWebhookConfig.findUnique.mockResolvedValue({ ...storedConfig, enabled: false } as never)

    expect((await POST(req('POST'))).status).toBe(400)
  })
})
