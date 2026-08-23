import { describe, expect, it, vi } from 'vitest'
import { mockPrisma } from '../setup'
import {
  createPublicOAuthClient,
  validateOAuthClient,
  validatePublicClientRegistration,
  validateRedirectUri,
} from '@/lib/oauth/oauth-client-manager'
import { verifyCodeChallenge } from '@/lib/oauth/oauth-token-manager'
import {
  createAuthorizationRedirect,
  validateAuthorizationRequest,
} from '@/lib/oauth/oauth-authorization'
import { exchangeAuthorizationCode } from '@/lib/oauth/oauth-token-manager'

describe('MCP OAuth public clients (task a0e0808c)', () => {
  it('registers a public authorization-code client without issuing a secret', async () => {
    mockPrisma.oAuthClient.create.mockResolvedValue({
      id: 'db-client',
      clientId: 'astrid_client_dynamic',
      clientSecret: null,
      tokenEndpointAuthMethod: 'none',
      name: 'GitHub Copilot',
      description: null,
      userId: null,
      redirectUris: ['https://vscode.dev/redirect'],
      grantTypes: ['authorization_code', 'refresh_token'],
      scopes: ['tasks:read'],
      isActive: true,
      createdAt: new Date('2026-08-16T00:00:00Z'),
      updatedAt: new Date('2026-08-16T00:00:00Z'),
      lastUsedAt: null,
    })

    const client = await createPublicOAuthClient({
      name: 'GitHub Copilot',
      redirectUris: ['https://vscode.dev/redirect'],
      scopes: ['tasks:read'],
    })

    expect(client.clientSecret).toBeUndefined()
    expect(client.tokenEndpointAuthMethod).toBe('none')
    expect(mockPrisma.oAuthClient.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        clientSecret: null,
        tokenEndpointAuthMethod: 'none',
        userId: null,
      }),
    }))
  })

  it('accepts only the public-client shape used by MCP hosts', () => {
    expect(validatePublicClientRegistration({
      redirect_uris: ['https://vscode.dev/redirect'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    })).toEqual(expect.objectContaining({
      redirectUris: ['https://vscode.dev/redirect'],
    }))

    expect(() => validatePublicClientRegistration({
      redirect_uris: ['javascript:alert(1)'],
      token_endpoint_auth_method: 'none',
    })).toThrow(/redirect/i)
    expect(() => validatePublicClientRegistration({
      redirect_uris: ['https://vscode.dev/redirect'],
      token_endpoint_auth_method: 'client_secret_post',
    })).toThrow(/public/i)
  })

  it('authenticates a registered public client without conflating it with a confidential client', async () => {
    mockPrisma.oAuthClient.findUnique.mockResolvedValue({
      id: 'db-client',
      clientId: 'astrid_client_dynamic',
      clientSecret: null,
      tokenEndpointAuthMethod: 'none',
      userId: null,
      redirectUris: ['https://vscode.dev/redirect'],
      grantTypes: ['authorization_code', 'refresh_token'],
      scopes: ['tasks:read'],
      isActive: true,
      user: null,
    })

    await expect(validateOAuthClient('astrid_client_dynamic')).resolves.toEqual(
      expect.objectContaining({ tokenEndpointAuthMethod: 'none' }),
    )
    await expect(validateOAuthClient('astrid_client_dynamic', 'invented-secret')).resolves.toBeNull()
  })

  it('verifies S256 PKCE and rejects a wrong verifier', () => {
    const verifier = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~'
    const challenge = 'ImpiCd8pp4MveCNnbIS7-GXEtB0xF5HMIDoWqvGA5ig'

    expect(verifyCodeChallenge(verifier, challenge, 'S256')).toBe(true)
    expect(verifyCodeChallenge(`${verifier}wrong`, challenge, 'S256')).toBe(false)
    expect(verifyCodeChallenge(verifier, verifier, 'plain')).toBe(false)
  })

  it('requires PKCE when a public client starts authorization', async () => {
    mockPrisma.oAuthClient.findFirst.mockResolvedValue({
      id: 'db-client',
      clientId: 'astrid_client_dynamic',
      tokenEndpointAuthMethod: 'none',
      name: 'GitHub Copilot',
      description: null,
      redirectUris: ['https://vscode.dev/redirect'],
      grantTypes: ['authorization_code', 'refresh_token'],
      scopes: ['tasks:read'],
      user: null,
    })

    await expect(validateAuthorizationRequest({
      clientId: 'astrid_client_dynamic',
      redirectUri: 'https://vscode.dev/redirect',
      responseType: 'code',
    })).rejects.toThrow(/PKCE/)

    await expect(validateAuthorizationRequest({
      clientId: 'astrid_client_dynamic',
      redirectUri: 'https://vscode.dev/redirect',
      responseType: 'code',
      codeChallenge: 'ImpiCd8pp4MveCNnbIS7-GXEtB0xF5HMIDoWqvGA5ig',
      codeChallengeMethod: 'S256',
    })).resolves.toEqual(expect.objectContaining({
      codeChallengeMethod: 'S256',
    }))
  })

  it('accepts Copilot CLI loopback callbacks when only the ephemeral port changes', () => {
    expect(validateRedirectUri(
      ['http://127.0.0.1:64831/'],
      'http://127.0.0.1:50719/',
    )).toBe(true)
    expect(validateRedirectUri(
      ['http://[::1]:64831/oauth/callback?client=copilot'],
      'http://[::1]:50719/oauth/callback?client=copilot',
    )).toBe(true)
  })

  it('keeps every non-port component of loopback callbacks exact', () => {
    const registered = ['http://127.0.0.1:64831/oauth/callback?client=copilot']

    expect(validateRedirectUri(registered, 'http://127.0.0.1:50719/other?client=copilot')).toBe(false)
    expect(validateRedirectUri(registered, 'http://127.0.0.1:50719/oauth/callback?client=other')).toBe(false)
    expect(validateRedirectUri(registered, 'http://localhost:50719/oauth/callback?client=copilot')).toBe(false)
    expect(validateRedirectUri(
      ['https://example.com:64831/oauth/callback'],
      'https://example.com:50719/oauth/callback',
    )).toBe(false)
  })

  it('binds the authorization code to the PKCE challenge and verifier', async () => {
    mockPrisma.oAuthAuthorizationCode.create.mockResolvedValue({ id: 'code-row' })
    const context = {
      client: {
        id: 'db-client',
        clientId: 'astrid_client_dynamic',
        name: 'GitHub Copilot',
        description: null,
        redirectUris: ['https://vscode.dev/redirect'],
        grantTypes: ['authorization_code', 'refresh_token'],
        scopes: ['tasks:read'] as const,
        tokenEndpointAuthMethod: 'none',
        owner: null,
      },
      redirectUri: 'https://vscode.dev/redirect',
      scopes: ['tasks:read'] as const,
      codeChallenge: 'ImpiCd8pp4MveCNnbIS7-GXEtB0xF5HMIDoWqvGA5ig',
      codeChallengeMethod: 'S256' as const,
    }

    await createAuthorizationRedirect('user-1', context)
    expect(mockPrisma.oAuthAuthorizationCode.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        codeChallenge: context.codeChallenge,
        codeChallengeMethod: 'S256',
      }),
    })

    mockPrisma.oAuthAuthorizationCode.findFirst.mockResolvedValue({
      id: 'code-row',
      code: 'astrid_code_x',
      clientId: 'db-client',
      userId: 'user-1',
      redirectUri: context.redirectUri,
      scopes: ['tasks:read'],
      codeChallenge: context.codeChallenge,
      codeChallengeMethod: 'S256',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      createdAt: new Date(),
    })

    await expect(exchangeAuthorizationCode(
      'astrid_code_x',
      'db-client',
      context.redirectUri,
      'wrong-verifier-that-is-long-enough-to-be-a-valid-pkce-value',
    )).resolves.toBeNull()
    expect(mockPrisma.oAuthAuthorizationCode.update).not.toHaveBeenCalled()
  })
})
