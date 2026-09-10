import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { mockPrisma } from '../setup'

vi.mock('@/lib/brand/capabilities', () => ({
  capabilityGate: vi.fn(() => null),
}))

import { POST } from '@/app/api/v1/oauth/register/route'
import { BRAND } from '@/lib/brand/config'

describe('POST /api/v1/oauth/register (task a0e0808c)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('dynamically registers a secretless MCP client', async () => {
    mockPrisma.oAuthClient.create.mockImplementation(async ({ data }) => ({
      id: 'db-client',
      ...data,
      description: null,
      createdAt: new Date('2026-08-16T00:00:00Z'),
      updatedAt: new Date('2026-08-16T00:00:00Z'),
      lastUsedAt: null,
    }))

    const response = await POST(new NextRequest(`https://${BRAND.domain}/api/v1/oauth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'GitHub Copilot',
        redirect_uris: ['https://vscode.dev/redirect'],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        scope: 'tasks:read lists:read',
      }),
    }))

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      client_id: expect.stringMatching(/^astrid_client_/),
      token_endpoint_auth_method: 'none',
      response_types: ['code'],
    }))
  })

  it('rejects unsafe redirect URIs', async () => {
    const response = await POST(new NextRequest(`https://${BRAND.domain}/api/v1/oauth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        redirect_uris: ['http://attacker.example/callback'],
        token_endpoint_auth_method: 'none',
      }),
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      error: 'invalid_client_metadata',
    }))
    expect(mockPrisma.oAuthClient.create).not.toHaveBeenCalled()
  })

  it('rejects confidential registration with an actionable error (task 4b41ab22)', async () => {
    const response = await POST(new NextRequest(`https://${BRAND.domain}/api/v1/oauth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Connector with a default confidential profile',
        redirect_uris: ['https://vscode.dev/redirect'],
        token_endpoint_auth_method: 'client_secret_post',
      }),
    }))

    expect(response.status).toBe(400)
    const payload = await response.json()
    expect(payload.error).toBe('invalid_client_metadata')
    expect(payload.error_description).toMatch(/token_endpoint_auth_method must be "none"/)
    expect(payload.error_description).toMatch(/Settings → API Access/)
    expect(mockPrisma.oAuthClient.create).not.toHaveBeenCalled()
  })
})
