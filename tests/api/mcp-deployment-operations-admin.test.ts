/**
 * RED for task a6760e6a.
 *
 * The MCP deployment operations validate a token and then construct a
 * VercelClient, which uses the deployment-wide VERCEL_TOKEN belonging to the
 * OPERATOR. repository, branch and deploymentId all come from the request. So
 * any user of the product could trigger deployments of the operator's Vercel
 * projects and read their build logs, which routinely name environment
 * variables and carry secrets.
 *
 * Nothing in the repo calls these, and they are not advertised in the MCP tool
 * definitions — they are reachable only through the operations endpoint. They
 * now require a platform admin.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const authenticateAPI = vi.hoisted(() => vi.fn())
const isAdmin = vi.hoisted(() => vi.fn())
const deployPRBranch = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-auth-middleware', () => ({
  authenticateAPI,
  UnauthorizedError: class extends Error {},
}))
vi.mock('@/lib/admin-auth', () => ({ isAdmin }))
vi.mock('@/lib/brand/capabilities', () => ({ capabilityGate: () => null }))
vi.mock('@/lib/rate-limiter', () => ({
  withRateLimit: () => () => ({ allowed: true, headers: {} }),
  RATE_LIMITS: { MCP_OPERATIONS: {} },
}))
vi.mock('@/lib/vercel-client', () => ({
  VercelClient: class {
    deployPRBranch = deployPRBranch
    getDeployment = vi.fn()
    getDeploymentLogs = vi.fn()
    listDeployments = vi.fn()
  },
}))

function post(body: unknown) {
  return new NextRequest('http://localhost/api/mcp/operations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  authenticateAPI.mockResolvedValue({
    userId: 'ordinary-user',
    source: 'session',
    scopes: [],
    isAIAgent: false,
    user: { id: 'ordinary-user', email: 'u@example.test', name: null, isAIAgent: false },
  })
  isAdmin.mockResolvedValue(false)
})

describe('MCP deployment operations require a platform admin (task a6760e6a)', () => {
  it.each([
    'deploy_to_staging',
    'get_deployment_status',
    'get_deployment_logs',
    'get_deployment_errors',
    'list_deployments',
  ])('refuses %s for a non-admin, without touching Vercel', async operation => {
    const { POST } = await import('@/app/api/mcp/operations/route')

    const response = await POST(
      post({ operation, args: { repository: 'someone/repo', branch: 'main', deploymentId: 'dpl_1' } }),
    )

    expect(response.status).toBe(403)
    expect(deployPRBranch).not.toHaveBeenCalled()
  })

  it('lets a platform admin through to the handler', async () => {
    isAdmin.mockResolvedValue(true)
    deployPRBranch.mockResolvedValue(null)
    const { POST } = await import('@/app/api/mcp/operations/route')

    const response = await POST(
      post({ operation: 'deploy_to_staging', args: { accessToken: 'astrid_mcp_x', repository: 'r', branch: 'b' } }),
    )

    expect(response.status).not.toBe(403)
  })
})
