/**
 * OAuth Authentication Tests
 *
 * Tests for OAuth 2.0 flows and unified authentication middleware
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockPrisma, mockGetServerSession } from '../setup'
import {
  createOAuthClient,
  validateClientCredentials,
} from '@/lib/oauth/oauth-client-manager'
import {
  generateAccessToken,
  validateAccessToken,
  hashClientSecret,
} from '@/lib/oauth/oauth-token-manager'
import { authenticateAPI } from '@/lib/api-auth-middleware'

describe('OAuth Authentication', () => {
  let testUserId: string
  let testClientId: string
  let testClientSecret: string
  let testClientSecretHash: string
  let mockOAuthClient: any
  let mockAccessToken: string

  beforeEach(() => {
    vi.clearAllMocks()

    // Disable session authentication for these tests
    mockGetServerSession.mockResolvedValue(null)

    // Set up test data
    testUserId = 'test-user-id'
    testClientId = 'astrid_client_abc123'
    testClientSecret = 'client-secret-xyz789'
    testClientSecretHash = hashClientSecret(testClientSecret) // SHA256 hash
    mockAccessToken = 'astrid_token_test123'

    // Mock OAuth client
    mockOAuthClient = {
      id: 'oauth-client-db-id',
      clientId: testClientId,
      clientSecret: testClientSecretHash,
      userId: testUserId,
      name: 'Test Client',
      description: 'Test OAuth client',
      redirectUris: [],
      grantTypes: ['client_credentials'],
      scopes: ['tasks:read', 'tasks:write'],
      createdAt: new Date(),
      updatedAt: new Date(),
      isActive: true,
      lastUsedAt: null,
      user: {
        id: testUserId,
        email: 'test@example.com',
        isAIAgent: false,
      },
    }

    // Mock user
    mockPrisma.user.findUnique.mockResolvedValue({
      id: testUserId,
      name: 'Test User',
      email: 'test@example.com',
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      emailVerified: null,
      isAIAgent: false,
    })
  })

  describe('OAuth Client Management', () => {
    it('should create OAuth client with credentials', async () => {
      const newClient = {
        ...mockOAuthClient,
        clientId: 'astrid_client_new123',
        clientSecret: 'plain-secret-for-return',
      }

      mockPrisma.oAuthClient.create.mockResolvedValue(newClient)

      const client = await createOAuthClient({
        userId: testUserId,
        name: 'Test Client',
        description: 'Test OAuth client',
        grantTypes: ['client_credentials'],
        scopes: ['tasks:read', 'tasks:write'],
      })

      expect(client.clientId).toBeDefined()
      expect(client.clientId).toMatch(/^astrid_client_/)
      expect(client.clientSecret).toBeDefined()
      expect(client.name).toBe('Test Client')
      expect(client.scopes).toContain('tasks:read')
      expect(mockPrisma.oAuthClient.create).toHaveBeenCalled()
    })

    it('should validate client credentials', async () => {
      mockPrisma.oAuthClient.findUnique.mockResolvedValue(mockOAuthClient)

      const validated = await validateClientCredentials(testClientId, testClientSecret)

      expect(validated).toBeDefined()
      expect(validated?.clientId).toBe(testClientId)
      expect(validated?.userId).toBe(testUserId)
      expect(validated?.scopes).toContain('tasks:read')
    })

    it('should reject invalid client credentials', async () => {
      mockPrisma.oAuthClient.findUnique.mockResolvedValue(mockOAuthClient)

      const validated = await validateClientCredentials(testClientId, 'wrong-secret')
      expect(validated).toBeNull()
    })
  })

  describe('OAuth Token Generation', () => {
    it('should generate access token', async () => {
      mockPrisma.oAuthClient.findUnique.mockResolvedValue(mockOAuthClient)
      mockPrisma.oAuthToken.create.mockResolvedValue({
        id: 'token-id',
        accessToken: mockAccessToken,
        tokenType: 'Bearer',
        clientId: mockOAuthClient.id,
        userId: testUserId,
        scopes: ['tasks:read', 'tasks:write'],
        expiresAt: new Date(Date.now() + 3600000),
        createdAt: new Date(),
        refreshToken: null,
        isRevoked: false,
      })

      const tokenResponse = await generateAccessToken(
        mockOAuthClient.id,
        testUserId,
        ['tasks:read', 'tasks:write']
      )

      expect(tokenResponse.accessToken).toBeDefined()
      expect(tokenResponse.accessToken).toMatch(/^astrid_/)
      expect(tokenResponse.tokenType).toBe('Bearer')
      expect(tokenResponse.expiresIn).toBe(3600)
      expect(tokenResponse.scope).toBe('tasks:read tasks:write')
      expect(mockPrisma.oAuthToken.create).toHaveBeenCalled()
    })

    it('should validate access token', async () => {
      const validToken = {
        id: 'token-id',
        accessToken: mockAccessToken,
        tokenType: 'Bearer',
        clientId: mockOAuthClient.id,
        userId: testUserId,
        scopes: ['tasks:read'],
        expiresAt: new Date(Date.now() + 3600000), // Not expired
        createdAt: new Date(),
        refreshToken: null,
        revokedAt: null,
        user: {
          id: testUserId,
          email: 'test@example.com',
          isAIAgent: false,
          name: 'Test User',
        },
      }

      mockPrisma.oAuthToken.findFirst.mockResolvedValue(validToken)

      const validated = await validateAccessToken(mockAccessToken)

      expect(validated).toBeDefined()
      expect(validated?.userId).toBe(testUserId)
      expect(validated?.scopes).toContain('tasks:read')
      expect(validated?.user).toBeDefined()
      expect(validated?.user.email).toBe('test@example.com')
    })

    it('should reject expired tokens', async () => {
      // Expired tokens don't match the Prisma where clause (expiresAt > now)
      // so findFirst returns null
      mockPrisma.oAuthToken.findFirst.mockResolvedValue(null)

      const validated = await validateAccessToken(mockAccessToken)
      expect(validated).toBeNull()
    })

    it('should reject revoked tokens', async () => {
      // Revoked tokens don't match the Prisma where clause (revokedAt === null)
      // so findFirst returns null
      mockPrisma.oAuthToken.findFirst.mockResolvedValue(null)

      const validated = await validateAccessToken(mockAccessToken)
      expect(validated).toBeNull()
    })
  })

  describe('Unified Authentication Middleware', () => {
    it('should authenticate with OAuth token', async () => {
      const validToken = {
        id: 'token-id',
        accessToken: mockAccessToken,
        tokenType: 'Bearer',
        clientId: mockOAuthClient.id,
        userId: testUserId,
        scopes: ['tasks:read', 'tasks:write'],
        expiresAt: new Date(Date.now() + 3600000),
        createdAt: new Date(),
        refreshToken: null,
        revokedAt: null,
        user: {
          id: testUserId,
          email: 'test@example.com',
          isAIAgent: false,
          name: 'Test User',
        },
      }

      mockPrisma.oAuthToken.findFirst.mockResolvedValue(validToken)

      // Create mock request with OAuth token
      const mockRequest = new Request('http://localhost:3000/api/v1/tasks', {
        headers: {
          'Authorization': `Bearer ${mockAccessToken}`,
        },
      }) as any

      const auth = await authenticateAPI(mockRequest)

      expect(auth.userId).toBe(testUserId)
      expect(auth.source).toBe('oauth')
      expect(auth.scopes).toContain('tasks:read')
      expect(auth.isAIAgent).toBe(false)
    })

    it('AWTD-755 keeps the human OAuth principal while exposing explicit Copilot authorship', async () => {
      mockPrisma.oAuthToken.findFirst.mockResolvedValue({
        id: 'token-id',
        accessToken: mockAccessToken,
        tokenType: 'Bearer',
        clientId: mockOAuthClient.id,
        userId: testUserId,
        scopes: ['tasks:read', 'tasks:write'],
        agentMailbox: 'copilot',
        expiresAt: new Date(Date.now() + 3600000),
        createdAt: new Date(),
        refreshToken: null,
        revokedAt: null,
        user: {
          id: testUserId,
          email: 'test@example.com',
          isAIAgent: false,
          name: 'Test User',
        },
      })
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'copilot-agent-id',
        email: 'copilot@astrid.cc',
        name: 'GitHub Copilot Agent',
        image: null,
      })

      const headers = new Headers()
      headers.set('authorization', ['Bearer', mockAccessToken].join(' '))
      const request = new Request('http://localhost:3000/api/v1/tasks', { headers }) as any
      const auth = await authenticateAPI(request)

      expect(auth.userId).toBe(testUserId)
      expect(auth.user.email).toBe('test@example.com')
      expect(auth.agentUser).toEqual({
        id: 'copilot-agent-id',
        email: 'copilot@astrid.cc',
        name: 'GitHub Copilot Agent',
        isAIAgent: true,
      })
    })

    it('AWTD-755 fails closed when a consent-bound Copilot identity cannot resolve', async () => {
      mockPrisma.oAuthToken.findFirst.mockResolvedValue({
        id: 'token-id',
        accessToken: mockAccessToken,
        clientId: mockOAuthClient.id,
        userId: testUserId,
        scopes: ['tasks:write'],
        agentMailbox: 'copilot',
        expiresAt: new Date(Date.now() + 3600000),
        revokedAt: null,
        user: {
          id: testUserId,
          email: 'test@example.com',
          isAIAgent: false,
          name: 'Test User',
        },
      })
      mockPrisma.user.findFirst.mockResolvedValue(null)
      mockPrisma.user.create.mockRejectedValue(new Error('agent unavailable'))

      const headers = new Headers()
      headers.set('authorization', ['Bearer', mockAccessToken].join(' '))
      const request = new Request('http://localhost:3000/api/v1/tasks', { headers }) as any
      request.cookies = { get: vi.fn().mockReturnValue(undefined) }

      await expect(authenticateAPI(request)).rejects.toThrow('No valid authentication found')
    })

    it('should authenticate with legacy MCP token', async () => {
      const mcpToken = 'astrid_mcp_test123'

      mockPrisma.mCPToken.findFirst.mockResolvedValue({
        id: 'mcp-token-id',
        token: mcpToken,
        userId: testUserId,
        permissions: ['read', 'write'],
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastUsedAt: null,
        expiresAt: null,
        agentUserId: null,
        agentMailbox: 'copilot',
        user: {
          id: testUserId,
          email: 'test@example.com',
          name: 'Test User',
          isAIAgent: false,
        },
        agentUser: null,
      })
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'copilot-agent-id',
        email: 'copilot@astrid.cc',
        name: 'GitHub Copilot Agent',
        image: null,
      })

      // Create mock request with MCP token and cookies object
      const mockRequest = new Request('http://localhost:3000/api/mcp/operations', {
        headers: {
          'X-MCP-Access-Token': mcpToken,
        },
      }) as any
      mockRequest.cookies = {
        get: vi.fn().mockReturnValue(undefined),
      }

      const auth = await authenticateAPI(mockRequest)

      expect(auth.userId).toBe(testUserId)
      expect(auth.source).toBe('legacy_mcp')
      expect(auth.scopes).toContain('*') // Legacy tokens have full access
      expect(auth.agentUser).toEqual({
        id: 'copilot-agent-id',
        email: 'copilot@astrid.cc',
        name: 'GitHub Copilot Agent',
        isAIAgent: true,
      })
      expect(mockPrisma.mCPToken.update).toHaveBeenCalledWith({
        where: { id: 'mcp-token-id' },
        data: { agentUserId: 'copilot-agent-id' },
      })
    })

    it('should reject invalid tokens', async () => {
      mockPrisma.oAuthToken.findFirst.mockResolvedValue(null)
      mockPrisma.mCPToken.findFirst.mockResolvedValue(null)

      const mockRequest = new Request('http://localhost:3000/api/v1/tasks', {
        headers: {
          'Authorization': 'Bearer invalid_token_12345',
        },
      }) as any
      mockRequest.cookies = {
        get: vi.fn().mockReturnValue(undefined),
      }

      await expect(authenticateAPI(mockRequest)).rejects.toThrow('No valid authentication found')
    })
  })

  describe('Backward Compatibility', () => {
    it('should support both OAuth and MCP tokens simultaneously', async () => {
      const oauthToken = {
        id: 'oauth-token-id',
        accessToken: mockAccessToken,
        tokenType: 'Bearer',
        clientId: mockOAuthClient.id,
        userId: testUserId,
        scopes: ['tasks:read'],
        expiresAt: new Date(Date.now() + 3600000),
        createdAt: new Date(),
        refreshToken: null,
        revokedAt: null,
        user: {
          id: testUserId,
          email: 'test@example.com',
          isAIAgent: false,
          name: 'Test User',
        },
      }

      const mcpToken = 'astrid_mcp_test456'

      // Mock OAuth token lookup
      mockPrisma.oAuthToken.findFirst.mockResolvedValue(oauthToken)

      // Test OAuth request
      const oauthRequest = new Request('http://localhost:3000/api/v1/tasks', {
        headers: { 'Authorization': `Bearer ${mockAccessToken}` },
      }) as any

      const oauthAuth = await authenticateAPI(oauthRequest)

      expect(oauthAuth.userId).toBe(testUserId)
      expect(oauthAuth.source).toBe('oauth')
      expect(oauthAuth.isAIAgent).toBe(false)

      // Reset mocks for MCP test
      vi.clearAllMocks()

      // Disable session auth for MCP test
      mockGetServerSession.mockResolvedValue(null)

      mockPrisma.mCPToken.findFirst.mockResolvedValue({
        id: 'mcp-token-id',
        token: mcpToken,
        userId: testUserId,
        permissions: ['read'],
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastUsedAt: null,
        expiresAt: null,
        user: {
          id: testUserId,
          email: 'test@example.com',
          name: 'Test User',
          isAIAgent: false,
        },
      })

      // Test MCP request
      const mcpRequest = new Request('http://localhost:3000/api/mcp/operations', {
        headers: { 'X-MCP-Access-Token': mcpToken },
      }) as any
      mcpRequest.cookies = {
        get: vi.fn().mockReturnValue(undefined),
      }

      const mcpAuth = await authenticateAPI(mcpRequest)

      expect(mcpAuth.userId).toBe(testUserId)
      expect(mcpAuth.source).toBe('legacy_mcp')
      expect(mcpAuth.scopes).toContain('*')
    })
  })
})
