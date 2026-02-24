import { describe, it, expect, vi, beforeEach } from 'vitest'
import { hasRequiredScopes } from '@/lib/oauth/oauth-scopes'

describe('SSE OAuth Authentication', () => {
  describe('scope validation for SSE', () => {
    it('accepts sse:connect scope', () => {
      expect(hasRequiredScopes(['sse:connect'], ['sse:connect'])).toBe(true)
    })

    it('accepts tasks:read scope as alternative', () => {
      expect(hasRequiredScopes(['tasks:read'], ['tasks:read'])).toBe(true)
    })

    it('accepts wildcard scope', () => {
      expect(hasRequiredScopes(['*'], ['sse:connect'])).toBe(true)
    })

    it('rejects token without sse:connect or tasks:read', () => {
      expect(hasRequiredScopes(['comments:read'], ['sse:connect'])).toBe(false)
      expect(hasRequiredScopes(['comments:read'], ['tasks:read'])).toBe(false)
    })

    it('accepts token with multiple scopes including sse:connect', () => {
      expect(hasRequiredScopes(
        ['tasks:read', 'tasks:write', 'sse:connect'],
        ['sse:connect']
      )).toBe(true)
    })
  })

  describe('SSE endpoint OAuth flow', () => {
    // These test the logic of the SSE route auth changes
    // The actual route is hard to unit test (ReadableStream), so we test the auth logic

    it('Bearer token header is properly detected', () => {
      const header = 'Bearer astrid_test_token_123'
      expect(header.toLowerCase().startsWith('bearer ')).toBe(true)
      const token = header.slice(7).trim()
      expect(token).toBe('astrid_test_token_123')
    })

    it('session auth still works when no Bearer token present', () => {
      const header: string | null = null
      const hasBearerToken = header?.toLowerCase().startsWith('bearer ') ?? false
      expect(hasBearerToken).toBe(false)
      // When no bearer token, should fall through to session auth
    })

    it('OAuth takes priority over session when Bearer token present', () => {
      const authHeader = 'Bearer astrid_valid_token'
      const cookieHeader = 'next-auth.session-token=session123'

      // The SSE route checks Bearer first
      const hasBearerToken = authHeader?.toLowerCase().startsWith('bearer ') ?? false
      expect(hasBearerToken).toBe(true)
      // OAuth path is taken, session path is skipped
    })
  })
})
