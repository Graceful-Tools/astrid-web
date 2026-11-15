/**
 * AWTD-1667 — GET /api/v1/agent-queue surfaces a runtime-binding denial as a
 * 403 with a machine-readable reason, never as an empty or personal queue.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api-auth-middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-auth-middleware')>(
    '@/lib/api-auth-middleware',
  )
  return { ...actual, authenticateAPI: vi.fn(), requireScopes: vi.fn() }
})
vi.mock('@/lib/agent-queue', async () => {
  const actual = await vi.importActual<typeof import('@/lib/agent-queue')>('@/lib/agent-queue')
  return { ...actual, buildAgentQueue: vi.fn() }
})

import { GET } from '@/app/api/v1/agent-queue/route'
import { authenticateAPI, requireScopes } from '@/lib/api-auth-middleware'
import { buildAgentQueue } from '@/lib/agent-queue'
import { RuntimeBindingDeniedError } from '@/lib/ai/runtime-binding-resolver'

describe('GET /api/v1/agent-queue — runtime binding denial (AWTD-1667)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAPI).mockResolvedValue({
      userId: 'user-1',
      source: 'oauth',
      scopes: ['tasks:read'],
      isAIAgent: false,
      user: { id: 'user-1', email: 'user@example.test', name: 'User', isAIAgent: false },
    } as never)
    vi.mocked(requireScopes).mockReturnValue(undefined)
  })

  it('answers 403 with the reason, binding and board', async () => {
    vi.mocked(buildAgentQueue).mockRejectedValue(
      new RuntimeBindingDeniedError({
        kind: 'denied',
        bindingId: 'binding-1',
        boardId: 'board-1',
        reason: 'binding-not-active',
        message: "This board's runtime binding is not active.",
      }),
    )
    const res = await GET(new NextRequest('http://localhost/api/v1/agent-queue?agent=claude&listId=board-1'))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({
      error: "This board's runtime binding is not active.",
      reason: 'binding-not-active',
      bindingId: 'binding-1',
      boardId: 'board-1',
    })
  })
})
