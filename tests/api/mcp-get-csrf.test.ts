/**
 * RED for task 06e176be.
 *
 * GET /api/mcp/operations dispatched the same switch as POST, and
 * authenticateAPI accepts the session cookie — which SameSite=Lax still sends
 * on a top-level navigation. So `window.location = '…?operation=delete_list…'`
 * from any site was a working CSRF against a signed-in user, reaching
 * delete_list, delete_task, remove_list_member, commit_changes,
 * merge_pull_request and update_user_settings.
 *
 * Separately, the access token was read from the query string, which puts a
 * bearer credential into access logs, history and Referer headers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const authenticateAPI = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-auth-middleware', () => ({
  authenticateAPI,
  getDeprecationWarning: () => null,
  UnauthorizedError: class extends Error {},
}))
vi.mock('@/lib/brand/capabilities', () => ({ capabilityGate: () => null }))
vi.mock('@/lib/rate-limiter', () => ({
  withRateLimitAsync: () => async () => ({ allowed: true, headers: {} }),
  RATE_LIMITS: { MCP_OPERATIONS: {} },
}))
vi.mock('@/lib/admin-auth', () => ({ isAdmin: vi.fn().mockResolvedValue(false) }))

function get(query: string) {
  return new NextRequest(`http://localhost/api/mcp/operations?${query}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  authenticateAPI.mockResolvedValue({
    userId: 'u1',
    source: 'session',
    scopes: [],
    isAIAgent: false,
    user: { id: 'u1', email: 'u@e.test', name: null, isAIAgent: false },
  })
})

describe('GET /api/mcp/operations (task 06e176be)', () => {
  it.each([
    'delete_list',
    'delete_task',
    'remove_list_member',
    'commit_changes',
    'merge_pull_request',
    'update_user_settings',
    'create_task',
  ])('refuses the state-changing operation %s with 405', async operation => {
    const { GET } = await import('@/app/api/mcp/operations/route')

    const response = await GET(get(`operation=${operation}&listId=abc`))

    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('POST')
  })

  it('rejects an access token in the query string', async () => {
    const { GET } = await import('@/app/api/mcp/operations/route')

    const response = await GET(get('operation=get_shared_lists&accessToken=astrid_mcp_secret'))

    expect(response.status).toBe(400)
  })

  it('still allows a read-only operation', async () => {
    const { GET } = await import('@/app/api/mcp/operations/route')

    const response = await GET(get('operation=get_shared_lists'))

    expect(response.status).not.toBe(405)
    expect(response.status).not.toBe(400)
  })
})
