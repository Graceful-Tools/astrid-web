/**
 * AWTD-1567: opt-in scope enforcement for newly scoped access tokens.
 *
 * Jon chose option 1 on 2026-11-26: a token minted with an explicit scope (the
 * `MCPToken.scope` column, null on every token that existed before) is held to
 * that scope — but only while `ASTRID_TOKEN_SCOPE_ENFORCEMENT` says so, and in
 * `canary` mode only for the owners named in `ASTRID_TOKEN_SCOPE_ENFORCEMENT_USERS`.
 * Unscoped tokens keep `*` whatever the flag says.
 *
 * These run the REAL middleware, wrapper and route modules against the prisma
 * mock, so a deny here is the 403 a client would get, from the route it called.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { mockPrisma } from '@/tests/setup'
import { authenticateAPI } from '@/lib/api-auth-middleware'
import { SCOPE_GROUPS } from '@/lib/oauth/oauth-scopes'
import { tokenScopeEnforced } from '@/lib/token-scope-enforcement'
import { POST as postTasks } from '@/app/api/v1/tasks/route'
import { GET as getTask, PUT as putTask, DELETE as deleteTask } from '@/app/api/v1/tasks/[id]/route'
import { GET as getLists } from '@/app/api/v1/lists/route'
import { POST as postComment } from '@/app/api/v1/tasks/[id]/comments/route'
import { POST as postOperation } from '@/app/api/mcp/operations/route'

const OWNER = { id: 'owner-1', email: 'owner@example.com', name: 'Owner', isAIAgent: false }
const TOKEN = 'astrid_mcp_' + 'a'.repeat(64)

function tokenRow(scope: string | null, userId = OWNER.id) {
  return {
    id: 'tok-1',
    userId,
    user: { ...OWNER, id: userId },
    agentUser: null,
    agentMailbox: null,
    permissions: ['read', 'write'],
    scope,
  }
}

function req(method: string, path: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { 'x-mcp-access-token': TOKEN, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const idParams = { params: Promise.resolve({ id: 'task-1' }) }

beforeEach(() => {
  vi.unstubAllEnvs()
  mockPrisma.mCPToken.findFirst.mockReset()
})
afterEach(() => vi.unstubAllEnvs())

describe('AWTD-1567: which tokens are enforced', () => {
  it('is off by default: a scoped token keeps *, its own scopes become the shadow', async () => {
    mockPrisma.mCPToken.findFirst.mockResolvedValue(tokenRow('tasks:read comments:read'))
    const auth = await authenticateAPI(req('GET', '/api/v1/tasks'))
    expect(auth.scopes).toEqual(['*'])
    expect(auth.shadowScopes).toEqual(['tasks:read', 'comments:read'])
    expect(auth.scopeEnforced).toBeFalsy()
  })

  it('on: a scoped token gets exactly its scopes', async () => {
    vi.stubEnv('ASTRID_TOKEN_SCOPE_ENFORCEMENT', 'on')
    mockPrisma.mCPToken.findFirst.mockResolvedValue(tokenRow('tasks:read comments:read'))
    const auth = await authenticateAPI(req('GET', '/api/v1/tasks'))
    expect(auth.scopes).toEqual(['tasks:read', 'comments:read'])
    expect(auth.scopeEnforced).toBe(true)
  })

  it('on: an unscoped (pre-existing) token is never touched', async () => {
    vi.stubEnv('ASTRID_TOKEN_SCOPE_ENFORCEMENT', 'on')
    mockPrisma.mCPToken.findFirst.mockResolvedValue(tokenRow(null))
    const auth = await authenticateAPI(req('GET', '/api/v1/tasks'))
    expect(auth.scopes).toEqual(['*'])
    expect(auth.shadowScopes).toEqual(SCOPE_GROUPS.ai_agent)
    expect(auth.scopeEnforced).toBeFalsy()
  })

  it('canary: only owners on the allowlist are enforced', () => {
    vi.stubEnv('ASTRID_TOKEN_SCOPE_ENFORCEMENT', 'canary')
    vi.stubEnv('ASTRID_TOKEN_SCOPE_ENFORCEMENT_USERS', ' other , owner-1 ')
    expect(tokenScopeEnforced('owner-1')).toBe(true)
    expect(tokenScopeEnforced('someone-else')).toBe(false)
    vi.stubEnv('ASTRID_TOKEN_SCOPE_ENFORCEMENT_USERS', '')
    expect(tokenScopeEnforced('owner-1')).toBe(false)
  })

  it('any value but on/canary is off', () => {
    for (const value of ['', 'true', '1', 'ON', 'shadow']) {
      vi.stubEnv('ASTRID_TOKEN_SCOPE_ENFORCEMENT', value)
      vi.stubEnv('ASTRID_TOKEN_SCOPE_ENFORCEMENT_USERS', 'owner-1')
      expect(tokenScopeEnforced('owner-1'), value).toBe(false)
    }
  })
})

describe('AWTD-1567: endpoints refuse an enforced token outside its scopes', () => {
  beforeEach(() => {
    vi.stubEnv('ASTRID_TOKEN_SCOPE_ENFORCEMENT', 'on')
    mockPrisma.mCPToken.findFirst.mockResolvedValue(tokenRow('tasks:read comments:read'))
  })

  it.each([
    ['POST /api/v1/tasks', () => postTasks(req('POST', '/api/v1/tasks', { title: 'x' })), 'tasks:write'],
    ['PUT /api/v1/tasks/:id', () => putTask(req('PUT', '/api/v1/tasks/task-1', { title: 'x' }), idParams), 'tasks:write'],
    ['DELETE /api/v1/tasks/:id', () => deleteTask(req('DELETE', '/api/v1/tasks/task-1'), idParams), 'tasks:delete'],
    ['GET /api/v1/lists', () => getLists(req('GET', '/api/v1/lists')), 'lists:read'],
    ['POST /api/v1/tasks/:id/comments', () => postComment(req('POST', '/api/v1/tasks/task-1/comments', { content: 'x' }), idParams), 'comments:write'],
  ])('%s → 403 naming %s', async (_name, call, missing) => {
    const res = await call()
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('Forbidden')
    expect(body.message).toContain(missing)
    expect(body.missingScopes).toEqual([missing])
    expect(body.tokenScopes).toEqual(['tasks:read', 'comments:read'])
  })

  it('serves a route inside its scopes (GET /api/v1/tasks/:id gets past auth)', async () => {
    const res = await getTask(req('GET', '/api/v1/tasks/task-1'), idParams)
    expect(res.status).not.toBe(403)
    expect(res.status).not.toBe(401)
  })

  it('the legacy /api/mcp/operations surface checks no scopes, so it refuses an enforced token', async () => {
    const res = await postOperation(req('POST', '/api/mcp/operations', { operation: 'get_shared_lists', args: {} }))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/scoped access token/i)
  })
})

describe('AWTD-1567: nothing changes while the flag is off or the token is unscoped', () => {
  it('flag off: the scoped token reaches the handler of a route outside its scopes', async () => {
    mockPrisma.mCPToken.findFirst.mockResolvedValue(tokenRow('tasks:read'))
    const res = await postTasks(req('POST', '/api/v1/tasks', {}))
    expect(res.status).not.toBe(403)
    expect(res.status).not.toBe(401)
  })

  it('flag on: an unscoped token reaches the handler of any route', async () => {
    vi.stubEnv('ASTRID_TOKEN_SCOPE_ENFORCEMENT', 'on')
    mockPrisma.mCPToken.findFirst.mockResolvedValue(tokenRow(null))
    const res = await postTasks(req('POST', '/api/v1/tasks', {}))
    expect(res.status).not.toBe(403)
    expect(res.status).not.toBe(401)
  })

  it('canary: a scoped token whose owner is not on the allowlist is not enforced', async () => {
    vi.stubEnv('ASTRID_TOKEN_SCOPE_ENFORCEMENT', 'canary')
    vi.stubEnv('ASTRID_TOKEN_SCOPE_ENFORCEMENT_USERS', 'someone-else')
    mockPrisma.mCPToken.findFirst.mockResolvedValue(tokenRow('tasks:read'))
    const res = await postTasks(req('POST', '/api/v1/tasks', {}))
    expect(res.status).not.toBe(403)
  })

  it('canary: the allowlisted owner is enforced', async () => {
    vi.stubEnv('ASTRID_TOKEN_SCOPE_ENFORCEMENT', 'canary')
    vi.stubEnv('ASTRID_TOKEN_SCOPE_ENFORCEMENT_USERS', 'owner-1')
    mockPrisma.mCPToken.findFirst.mockResolvedValue(tokenRow('tasks:read'))
    const res = await postTasks(req('POST', '/api/v1/tasks', {}))
    expect(res.status).toBe(403)
  })
})
