import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Mock prisma
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    listMember: {
      create: vi.fn(),
    },
  },
}))

// Mock OAuth client manager
vi.mock('@/lib/oauth/oauth-client-manager', () => ({
  createOAuthClient: vi.fn(),
}))

// Mock agent rate limiter — always allow
vi.mock('@/lib/agent-rate-limiter', () => ({
  AGENT_RATE_LIMITS: { REGISTRATION: {} },
  checkAgentRateLimit: vi.fn().mockResolvedValue({ response: null, headers: {} }),
  addRateLimitHeaders: vi.fn((_res: any) => _res),
}))

// Mock auth middleware
vi.mock('@/lib/api-auth-middleware', () => {
  class UnauthorizedError extends Error {
    name = 'UnauthorizedError'
    constructor(msg = 'Unauthorized') { super(msg) }
  }
  class ForbiddenError extends Error {
    name = 'ForbiddenError'
    constructor(msg = 'Forbidden') { super(msg) }
  }
  return {
    authenticateAPI: vi.fn(),
    UnauthorizedError,
    ForbiddenError,
  }
})

// Import after mocks
import { POST } from '@/app/api/v1/openclaw/register/route'
import { prisma } from '@/lib/prisma'
import { createOAuthClient } from '@/lib/oauth/oauth-client-manager'
import { authenticateAPI } from '@/lib/api-auth-middleware'

const mockPrisma = vi.mocked(prisma)
const mockCreateOAuthClient = vi.mocked(createOAuthClient)
const mockAuthenticateAPI = vi.mocked(authenticateAPI)

function makeRequest(body: any): NextRequest {
  return new NextRequest('http://localhost/api/v1/openclaw/register', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer astrid_test_token',
    },
    body: JSON.stringify(body),
  })
}

describe('POST /api/v1/openclaw/register', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthenticateAPI.mockResolvedValue({
      userId: 'user-123',
      source: 'oauth',
      scopes: ['*'],
      isAIAgent: false,
      user: { id: 'user-123', email: 'jon@example.com', name: 'Jon', isAIAgent: false },
    })
  })

  it('creates agent user and OAuth client for valid registration', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null as any)
    mockPrisma.user.create.mockResolvedValue({
      id: 'agent-456',
      email: 'astrid.oc@astrid.cc',
      name: 'astrid (OpenClaw)',
      isAIAgent: true,
      aiAgentType: 'openclaw_worker',
    } as any)
    mockCreateOAuthClient.mockResolvedValue({
      clientId: 'astrid_client_abc',
      clientSecret: 'secret123',
      scopes: ['tasks:read', 'tasks:write', 'comments:read', 'comments:write', 'sse:connect'],
      name: 'test',
      description: null,
      redirectUris: [],
      grantTypes: ['client_credentials'],
      createdAt: new Date(),
    })

    const res = await POST(makeRequest({ agentName: 'astrid' }))
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.agent.email).toBe('astrid.oc@astrid.cc')
    expect(json.agent.aiAgentType).toBe('openclaw_worker')
    expect(json.oauth.clientId).toBe('astrid_client_abc')
    expect(json.oauth.clientSecret).toBe('secret123')
    expect(json.config.sseEndpoint).toContain('/api/v1/agent/events')

    expect(mockPrisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'astrid.oc@astrid.cc',
          isAIAgent: true,
          aiAgentType: 'openclaw_worker',
        }),
      })
    )
  })

  it('returns 409 for duplicate agent name', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'existing-agent',
      email: 'astrid.oc@astrid.cc',
    } as any)

    const res = await POST(makeRequest({ agentName: 'astrid' }))
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toContain('already exists')
  })

  it('rejects names that are too short', async () => {
    const res = await POST(makeRequest({ agentName: 'a' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('Invalid agent name')
  })

  it('rejects names with special characters', async () => {
    const res = await POST(makeRequest({ agentName: 'agent!@#' }))
    expect(res.status).toBe(400)
  })

  it('rejects reserved names', async () => {
    const res = await POST(makeRequest({ agentName: 'admin' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('reserved')
  })

  it('rejects missing agentName', async () => {
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
  })

  it('returns 401 for unauthenticated requests', async () => {
    // Create an error that matches the pattern checked in the route
    const err = new Error('Unauthorized')
    err.name = 'UnauthorizedError'
    mockAuthenticateAPI.mockRejectedValue(err)

    const res = await POST(makeRequest({ agentName: 'test-agent' }))
    expect(res.status).toBe(401)
  })
})

describe('OpenClaw agent email pattern matching', () => {
  const pattern = /\.oc@astrid\.cc$/i

  it('matches standard .oc@astrid.cc emails', () => {
    expect(pattern.test('astrid.oc@astrid.cc')).toBe(true)
    expect(pattern.test('jeff.oc@astrid.cc')).toBe(true)
    expect(pattern.test('my-agent.oc@astrid.cc')).toBe(true)
    expect(pattern.test('agent.v2.oc@astrid.cc')).toBe(true)
  })

  it('does not match non-openclaw emails', () => {
    expect(pattern.test('claude@astrid.cc')).toBe(false)
    expect(pattern.test('user@gmail.com')).toBe(false)
    expect(pattern.test('oc@astrid.cc')).toBe(false)
  })
})
