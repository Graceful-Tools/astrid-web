import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}))

vi.mock('@/lib/api-auth-middleware', () => {
  class UnauthorizedError extends Error {
    constructor(msg = 'Unauthorized') { super(msg); this.name = 'UnauthorizedError' }
  }
  class ForbiddenError extends Error {
    constructor(msg = 'Forbidden') { super(msg); this.name = 'ForbiddenError' }
  }
  return {
    authenticateAPI: vi.fn(),
    requireScopes: vi.fn(),
    UnauthorizedError,
    ForbiddenError,
    getDeprecationWarning: vi.fn(() => null),
  }
})

import { PATCH, DELETE } from '@/app/api/v1/openclaw/agents/[id]/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI } from '@/lib/api-auth-middleware'

const mockPrisma = vi.mocked(prisma)
const mockAuth = vi.mocked(authenticateAPI)

const authedUser = {
  userId: 'owner-123',
  source: 'oauth' as const,
  scopes: ['*'],
  isAIAgent: false,
  user: { id: 'owner-123', email: 'jon@example.com', name: 'Jon', isAIAgent: false },
}

function makeReq(method: 'PATCH' | 'DELETE', body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/v1/openclaw/agents/agent-1', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

const params = Promise.resolve({ id: 'agent-1' })

const ownedAgent = {
  id: 'agent-1',
  email: 'astrid.oc@astrid.cc',
  image: '/images/ai-agents/openclaw.svg',
  aiAgentType: 'openclaw_worker',
  aiAgentConfig: JSON.stringify({ registeredBy: 'owner-123', agentName: 'astrid', version: '1.0' }),
}

const foreignAgent = {
  ...ownedAgent,
  aiAgentConfig: JSON.stringify({ registeredBy: 'someone-else', agentName: 'astrid', version: '1.0' }),
}

describe('PATCH /api/v1/openclaw/agents/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(authedUser as any)
  })

  it('returns 404 when agent does not exist', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null as any)
    const res = await PATCH(makeReq('PATCH', { image: '/x.png' }), { params } as any)
    expect(res.status).toBe(404)
  })

  it('returns 404 when agent is not owned by caller (no info leak)', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(foreignAgent as any)
    const res = await PATCH(makeReq('PATCH', { image: '/x.png' }), { params } as any)
    expect(res.status).toBe(404)
  })

  it('updates the agent image when caller is the owner', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(ownedAgent as any)
    mockPrisma.user.update.mockResolvedValue({} as any)

    const res = await PATCH(makeReq('PATCH', { image: '/custom.png' }), { params } as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.image).toBe('/custom.png')
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'agent-1' }, data: { image: '/custom.png' } })
    )
  })

  it('resets to default image when image is falsy', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(ownedAgent as any)
    mockPrisma.user.update.mockResolvedValue({} as any)

    const res = await PATCH(makeReq('PATCH', { image: null }), { params } as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.image).toBe('/images/ai-agents/openclaw.svg')
  })

  it('returns 400 when no valid fields are present', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(ownedAgent as any)
    const res = await PATCH(makeReq('PATCH', {}), { params } as any)
    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/v1/openclaw/agents/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(authedUser as any)
  })

  it('returns 404 when agent does not exist', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null as any)
    const res = await DELETE(makeReq('DELETE'), { params } as any)
    expect(res.status).toBe(404)
  })

  it('returns 404 when caller does not own the agent', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(foreignAgent as any)
    const res = await DELETE(makeReq('DELETE'), { params } as any)
    expect(res.status).toBe(404)
    expect(mockPrisma.user.delete).not.toHaveBeenCalled()
  })

  it('deletes when caller is the owner', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(ownedAgent as any)
    mockPrisma.user.delete.mockResolvedValue({} as any)

    const res = await DELETE(makeReq('DELETE'), { params } as any)
    expect(res.status).toBe(200)
    expect(mockPrisma.user.delete).toHaveBeenCalledWith({ where: { id: 'agent-1' } })
  })

  it('rejects non-openclaw users with 404', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      ...ownedAgent,
      aiAgentType: 'claude_worker',
    } as any)
    const res = await DELETE(makeReq('DELETE'), { params } as any)
    expect(res.status).toBe(404)
  })
})
