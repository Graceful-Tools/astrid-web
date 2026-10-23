/**
 * POST /api/webhooks/ai-agents — authorization (AWTD-1341).
 *
 * The webhook is unauthenticated at the transport level: the only credential
 * is `accessToken` in the body, which must resolve to an active MCP token
 * owned by the AI agent named in `aiAgent.id`, and the task must be assigned
 * to that same agent. These cases pin that a forged body, a token for a
 * different agent, and a task assigned to someone else are all refused before
 * anything is written.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { hashMCPToken } from '@/lib/mcp-token'

const tokenFindFirst = vi.hoisted(() => vi.fn())
const taskFindFirst = vi.hoisted(() => vi.fn())
const completeTask = vi.hoisted(() => vi.fn())
const postCommentAs = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    mCPToken: { findFirst: tokenFindFirst },
    task: { findFirst: taskFindFirst, findUnique: vi.fn().mockResolvedValue(null) },
    user: { findUnique: vi.fn().mockResolvedValue({ id: 'agent-1' }), create: vi.fn(), findFirst: vi.fn() },
  },
}))
vi.mock('@/lib/rate-limiter', () => ({
  RATE_LIMITS: { WEBHOOK: {} },
  withRateLimitAsync: () => async () => ({ allowed: true, headers: {} }),
}))
vi.mock('@/lib/sse-utils', () => ({ broadcastToUsers: vi.fn() }))
vi.mock('@/lib/ai-agent-webhook-service', () => ({ aiAgentWebhookService: {} }))
vi.mock('@/services/complete-task', () => ({ completeTask }))
vi.mock('@/services/post-comment-as', () => ({ postCommentAs }))

import { POST } from '@/app/api/webhooks/ai-agents/route'

const PLAINTEXT = 'astrid_mcp_' + 'a'.repeat(64)

function payload(overrides: Record<string, unknown> = {}) {
  return {
    event: 'task.completed',
    timestamp: new Date().toISOString(),
    aiAgent: { id: 'agent-1', type: 'claude_agent' },
    task: { id: 'task-1', completed: true },
    accessToken: PLAINTEXT,
    ...overrides,
  }
}

function post(body: unknown) {
  return POST(new NextRequest('http://localhost/api/webhooks/ai-agents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

const TOKEN_ROW = { id: 'tok-1', userId: 'agent-1', user: { id: 'agent-1', name: 'Agent', isAIAgent: true } }

function expectNothingWritten() {
  expect(completeTask).not.toHaveBeenCalled()
  expect(postCommentAs).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.clearAllMocks()
  tokenFindFirst.mockResolvedValue(TOKEN_ROW)
  taskFindFirst.mockResolvedValue({ id: 'task-1', title: 'T', assigneeId: 'agent-1' })
  completeTask.mockResolvedValue({ ok: true })
  postCommentAs.mockResolvedValue({ ok: true })
})

describe('POST /api/webhooks/ai-agents authorization (AWTD-1341)', () => {
  it('AWTD-1341: refuses a body with no accessToken at all (schema), writing nothing', async () => {
    const { accessToken: _omit, ...forged } = payload()
    const res = await post(forged)
    expect(res.status).toBe(400)
    expect(tokenFindFirst).not.toHaveBeenCalled()
    expectNothingWritten()
  })

  it('AWTD-1341: refuses a forged token that matches no active agent token with 401', async () => {
    tokenFindFirst.mockResolvedValue(null)
    const res = await post(payload({ accessToken: 'astrid_mcp_forged' }))
    expect(res.status).toBe(401)
    expect(taskFindFirst).not.toHaveBeenCalled()
    expectNothingWritten()
  })

  it('AWTD-1341: binds the token to the agent named in the body — active, AI agent, same id', async () => {
    tokenFindFirst.mockResolvedValue(null)
    await post(payload({ aiAgent: { id: 'agent-2', type: 'claude_agent' } }))
    const where = tokenFindFirst.mock.calls[0][0].where
    expect(where.isActive).toBe(true)
    expect(where.user).toEqual({ isAIAgent: true, id: 'agent-2' })
  })

  it('AWTD-1341: a valid token for an agent the task is not assigned to gets 404, writing nothing', async () => {
    taskFindFirst.mockResolvedValue(null)
    const res = await post(payload())
    expect(res.status).toBe(404)
    expect(taskFindFirst.mock.calls[0][0].where).toEqual({ id: 'task-1', assigneeId: 'agent-1' })
    expectNothingWritten()
  })

  it('AWTD-1341: the matching agent + assigned task is let through (control)', async () => {
    const res = await post(payload())
    expect(res.status).toBe(200)
    expect(completeTask).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'task-1', actorId: 'agent-1' }))
  })

  /*
   * REAL BUG (AWTD-1341): app/api/webhooks/ai-agents/route.ts:179-190 looks
   * the token up with `token: payload.accessToken` — a verbatim compare
   * against the `token` column, which now holds the SHA-256 hash
   * (lib/mcp-token.ts). Every other MCP-token lookup goes through
   * mcpTokenLookup(), which hashes the presented value and refuses a bare
   * stored hash (task 0845cf1c). Consequences here:
   *   1. Presenting the STORED HASH (DB/backup/export leak) authenticates as
   *      the agent — exactly the threat hashing was meant to close.
   *   2. A genuine plaintext token never matches a migrated row, so honest
   *      agents get 401.
   *   3. `expiresAt` is not checked, so an expired token is accepted.
   * Flip these to `it` when the lookup uses mcpTokenLookup + the expiry OR.
   */
  it.fails('AWTD-1341 BUG: looks the token up by its hash, never by the raw presented value', async () => {
    await post(payload())
    const where = tokenFindFirst.mock.calls[0][0].where
    expect(where.token).toEqual({ in: expect.arrayContaining([hashMCPToken(PLAINTEXT)]) })
  })

  it.fails('AWTD-1341 BUG: a stored hash presented as the bearer is not a credential', async () => {
    const storedHash = hashMCPToken(PLAINTEXT)
    await post(payload({ accessToken: storedHash }))
    const where = tokenFindFirst.mock.calls[0][0].where
    // The raw hash must not be among the values matched against the column.
    expect(JSON.stringify(where.token)).not.toContain(`"${storedHash}"`)
  })

  it.fails('AWTD-1341 BUG: an expired token is refused', async () => {
    await post(payload())
    const where = tokenFindFirst.mock.calls[0][0].where
    expect(where.OR).toEqual([{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }])
  })
})
