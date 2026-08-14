/**
 * RED for task 3428a53c — the two routes that MINT an MCP credential do not
 * check whether this deployment has MCP at all.
 *
 * Every route that CONSUMES an MCP token gates on
 * `capabilityGate('integrationMcp')`: mcp/context, mcp/operations, mcp/sync,
 * mcp/tokens, mcp/user-tokens, and the .well-known descriptor. The two that
 * hand out the credential — /api/auth/mobile-mcp-token and its v1 twin — did
 * not, so a deployment with MCP switched off still issued a 90-day read+write
 * token on request.
 *
 * Jon's call on the open question was 404 (comment of 2026-08-14): an
 * MCP-disabled deployment should look like it has no such endpoint, matching
 * capabilityGate's own not-403 reasoning.
 *
 * Low severity by itself, because the minted token cannot be spent — every
 * consumer 404s. The reason to fix it anyway is that the inertness depends on
 * ELEVEN other routes each remembering their gate, and this endpoint is the
 * one that would turn any single omission into a live credential.
 *
 * DELETE is covered as well as POST: revocation is the other half of the same
 * surface, and a gate on only the minting half would still leak the
 * endpoint's existence.
 *
 * The gate must run BEFORE the session is resolved, so a disabled deployment
 * cannot be probed for whether a given cookie is valid.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const capabilityGate = vi.hoisted(() => vi.fn())
vi.mock('@/lib/brand/capabilities', () => ({
  capabilityGate,
  CAPABILITIES: {},
}))

const resolveMobileSessionUser = vi.hoisted(() => vi.fn())
const mintOrReturnMobileToken = vi.hoisted(() => vi.fn())
const revokeMobileTokens = vi.hoisted(() => vi.fn())
vi.mock('@/lib/mobile-mcp-token', () => ({
  resolveMobileSessionUser,
  mintOrReturnMobileToken,
  revokeMobileTokens,
}))

import { POST as legacyPOST, DELETE as legacyDELETE } from '@/app/api/auth/mobile-mcp-token/route'
import { POST as v1POST, DELETE as v1DELETE } from '@/app/api/v1/auth/mobile-mcp-token/route'

const disabled = () =>
  new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  })

function req(path: string, method: 'POST' | 'DELETE') {
  return new NextRequest(`http://localhost${path}`, { method })
}

const ROUTES = [
  { name: 'legacy POST', handler: legacyPOST, path: '/api/auth/mobile-mcp-token', method: 'POST' as const },
  { name: 'legacy DELETE', handler: legacyDELETE, path: '/api/auth/mobile-mcp-token', method: 'DELETE' as const },
  { name: 'v1 POST', handler: v1POST, path: '/api/v1/auth/mobile-mcp-token', method: 'POST' as const },
  { name: 'v1 DELETE', handler: v1DELETE, path: '/api/v1/auth/mobile-mcp-token', method: 'DELETE' as const },
]

beforeEach(() => {
  vi.clearAllMocks()
  resolveMobileSessionUser.mockResolvedValue({ ok: true, userId: 'user-1' })
  mintOrReturnMobileToken.mockResolvedValue({ token: 'mcp_plaintext', userId: 'user-1' })
  revokeMobileTokens.mockResolvedValue({ count: 2 })
})

describe('mobile-mcp-token routes honour the integrationMcp capability (task 3428a53c)', () => {
  describe.each(ROUTES)('$name', ({ handler, path, method }) => {
    it('404s when MCP is disabled for this deployment', async () => {
      capabilityGate.mockReturnValue(disabled())

      const response = await handler(req(path, method))

      expect(capabilityGate).toHaveBeenCalledWith('integrationMcp')
      expect(response.status).toBe(404)
      await expect(response.json()).resolves.toEqual({ error: 'Not found' })
    })

    it('does not resolve the session when MCP is disabled', async () => {
      capabilityGate.mockReturnValue(disabled())

      await handler(req(path, method))

      // Gate before auth: a disabled deployment must not become an oracle for
      // whether a stolen session cookie is still valid.
      expect(resolveMobileSessionUser).not.toHaveBeenCalled()
    })

    it('does not touch the token store when MCP is disabled', async () => {
      capabilityGate.mockReturnValue(disabled())

      await handler(req(path, method))

      expect(mintOrReturnMobileToken).not.toHaveBeenCalled()
      expect(revokeMobileTokens).not.toHaveBeenCalled()
    })

    it('proceeds normally when MCP is enabled', async () => {
      capabilityGate.mockReturnValue(null)

      const response = await handler(req(path, method))

      expect(response.status).toBe(200)
      expect(resolveMobileSessionUser).toHaveBeenCalled()
    })
  })

  it('still returns the plaintext token on the enabled path, per response shape', async () => {
    capabilityGate.mockReturnValue(null)

    const legacy = await (await legacyPOST(req('/api/auth/mobile-mcp-token', 'POST'))).json()
    const v1 = await (await v1POST(req('/api/v1/auth/mobile-mcp-token', 'POST'))).json()

    // The gate must not disturb the shapes: legacy is bare, v1 carries meta.
    expect(legacy).toEqual({ token: 'mcp_plaintext', userId: 'user-1' })
    expect(v1).toEqual({
      token: 'mcp_plaintext',
      userId: 'user-1',
      meta: { apiVersion: 'v1', authSource: 'cookie' },
    })
  })
})
