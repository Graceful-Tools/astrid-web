/**
 * AWTD-1302: on a GitHub Projects brand (coding agent OFF) the GitHub App
 * connection itself was unreachable — `/api/github/setup`, the install URL,
 * the installations list and disconnect all answered to `codingAgent`, so a
 * user signed in with GitHub could never store the App token the project
 * picker needs.
 *
 * The connection now answers to `githubConnection` (spec §7.5): on when the
 * coding agent OR GitHub Projects is on, and still refused when both are off.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { mockGetServerSession } from '../setup'

const COMBOS = [
  { codingAgent: true, githubProjects: false },
  { codingAgent: false, githubProjects: true },
  { codingAgent: true, githubProjects: true },
  { codingAgent: false, githubProjects: false },
] as const

function stubCapabilities(combo: { codingAgent: boolean; githubProjects: boolean }) {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_BRAND_ENABLE_CODING_AGENT', combo.codingAgent ? 'true' : 'false')
  vi.stubEnv('NEXT_PUBLIC_BRAND_ENABLE_GITHUB_PROJECTS', combo.githubProjects ? 'true' : 'false')
}

const getRequest = (url: string) => ({ url, headers: { get: () => null } }) as any

describe('the GitHub App connection answers to codingAgent || githubProjects (AWTD-1302)', () => {
  beforeEach(() => {
    mockGetServerSession.mockResolvedValue(null)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it.each(COMBOS)('githubConnection is %o → codingAgent || githubProjects', async combo => {
    stubCapabilities(combo)
    const { CAPABILITIES } = await import('@/lib/brand/capabilities')
    expect(CAPABILITIES.githubConnection).toBe(combo.codingAgent || combo.githubProjects)
  })

  it.each(COMBOS)('/api/github/setup with %o', async combo => {
    stubCapabilities(combo)
    const { GET } = await import('@/app/api/github/setup/route')
    const res = await GET(getRequest('http://localhost/api/github/setup?installation_id=1&setup_action=install'))
    if (combo.codingAgent || combo.githubProjects) {
      // Past the gate: unauthenticated, so it sends the browser to sign in.
      expect(res.status).toBe(307)
      expect(res.headers.get('location')).toContain('/auth/signin')
    } else {
      expect(res.status).toBe(404)
    }
  })

  it.each(COMBOS)('/api/github/install-url with %o', async combo => {
    stubCapabilities(combo)
    const { GET } = await import('@/app/api/github/install-url/route')
    const res = await GET(getRequest('http://localhost/api/github/install-url'))
    expect(res.status).toBe(combo.codingAgent || combo.githubProjects ? 401 : 404)
  })

  it.each(COMBOS)('/api/github/disconnect with %o', async combo => {
    stubCapabilities(combo)
    const { POST } = await import('@/app/api/github/disconnect/route')
    const res = await POST({ ...getRequest('http://localhost/api/github/disconnect'), json: async () => ({}) } as any)
    expect(res.status).toBe(combo.codingAgent || combo.githubProjects ? 401 : 404)
  })

  it('keeps the coding agent’s own routes on codingAgent alone', async () => {
    stubCapabilities({ codingAgent: false, githubProjects: true })
    const { GET } = await import('@/app/api/v1/github/repositories/route')
    const res = await GET(getRequest('http://localhost/api/github/repositories'))
    expect(res.status).toBe(404)
  })
})
