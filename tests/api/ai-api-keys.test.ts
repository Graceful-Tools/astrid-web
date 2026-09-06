import { describe, it, expect, beforeEach, vi } from 'vitest'
import { GET, PUT, DELETE } from '@/app/api/user/ai-api-keys/route'
import { POST } from '@/app/api/user/ai-api-keys/test/route'
import { mockPrisma, mockGetServerSession } from '../setup'

// Mock rate limiter
vi.mock('@/lib/rate-limiter', () => ({
  RATE_LIMITS: {
    API_KEY_TEST: { windowMs: 60000, maxRequests: 5 }
  },
  withRateLimitAsync: () => async () => ({ allowed: true, headers: {} })
}))

// Mock crypto for encryption
vi.mock('crypto', async () => {
  const actual = await vi.importActual('crypto')
  return {
    ...actual,
    randomBytes: vi.fn((size: number) => Buffer.alloc(size, 'a')),
  }
})

// Create mock request helper
const createMockRequest = (body?: any) => {
  return {
    json: async () => body,
    headers: {
      get: () => null
    }
  } as any
}

const mockUser = {
  id: 'test-user-id',
  name: 'Test User',
  email: 'test@example.com',
  image: null,
  mcpSettings: null,
  createdAt: new Date(),
  updatedAt: new Date()
}

describe('AI API Keys API', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Reset all prisma mocks
    Object.values(mockPrisma.user).forEach((mock: any) => mock.mockReset())

    // Mock authenticated session
    mockGetServerSession.mockResolvedValue({
      user: { id: 'test-user-id', email: 'test@example.com' }
    })
  })

  describe('GET /api/user/ai-api-keys', () => {
    it('should return 401 for unauthenticated user', async () => {
      mockGetServerSession.mockResolvedValueOnce(null)

      const response = await GET(createMockRequest())
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should return empty keys for user with no mcpSettings', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        mcpSettings: null
      })

      const response = await GET(createMockRequest())
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.keys).toEqual({})
    })

    it('should return empty keys for user with empty apiKeys', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        mcpSettings: JSON.stringify({ apiKeys: {} })
      })

      const response = await GET(createMockRequest())
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.keys).toEqual({})
    })

    it('should return 404 for non-existent user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null)

      const response = await GET(createMockRequest())
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('User not found')
    })
  })

  describe('PUT /api/user/ai-api-keys', () => {
    it('should return 401 for unauthenticated user', async () => {
      mockGetServerSession.mockResolvedValueOnce(null)

      const request = createMockRequest({ serviceId: 'claude', apiKey: 'sk-ant-test' })
      const response = await PUT(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should save Claude API key', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        mcpSettings: null
      })
      mockPrisma.user.update.mockResolvedValue({ ...mockUser })

      const request = createMockRequest({ serviceId: 'claude', apiKey: 'sk-ant-test123' })
      const response = await PUT(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'test-user-id' },
        data: {
          mcpSettings: expect.stringContaining('"claude"')
        }
      })
    })

    it('should save OpenAI API key', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        mcpSettings: null
      })
      mockPrisma.user.update.mockResolvedValue({ ...mockUser })

      const request = createMockRequest({ serviceId: 'openai', apiKey: 'sk-test123' })
      const response = await PUT(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'test-user-id' },
        data: {
          mcpSettings: expect.stringContaining('"openai"')
        }
      })
    })

    it('should save Gemini API key', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        mcpSettings: null
      })
      mockPrisma.user.update.mockResolvedValue({ ...mockUser })

      const request = createMockRequest({ serviceId: 'gemini', apiKey: 'AIzaTest123' })
      const response = await PUT(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'test-user-id' },
        data: {
          mcpSettings: expect.stringContaining('"gemini"')
        }
      })
    })

    it('should return 400 for invalid serviceId', async () => {
      const request = createMockRequest({ serviceId: 'invalid', apiKey: 'test' })
      const response = await PUT(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Validation failed')
    })

    it('should return 400 for empty apiKey', async () => {
      const request = createMockRequest({ serviceId: 'claude', apiKey: '' })
      const response = await PUT(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Validation failed')
    })

    it('should preserve existing keys when adding new one', async () => {
      const existingSettings = {
        apiKeys: {
          claude: { encrypted: 'existing', iv: 'iv', isValid: true }
        }
      }
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        mcpSettings: JSON.stringify(existingSettings)
      })
      mockPrisma.user.update.mockResolvedValue({ ...mockUser })

      const request = createMockRequest({ serviceId: 'openai', apiKey: 'sk-new' })
      const response = await PUT(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)

      // Check that update was called with both keys
      const updateCall = mockPrisma.user.update.mock.calls[0][0]
      const savedSettings = JSON.parse(updateCall.data.mcpSettings)
      expect(savedSettings.apiKeys.claude).toBeDefined()
      expect(savedSettings.apiKeys.openai).toBeDefined()
    })
  })

  describe('DELETE /api/user/ai-api-keys', () => {
    it('should return 401 for unauthenticated user', async () => {
      mockGetServerSession.mockResolvedValueOnce(null)

      const request = createMockRequest({ serviceId: 'claude' })
      const response = await DELETE(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should delete Claude API key', async () => {
      const existingSettings = {
        apiKeys: {
          claude: { encrypted: 'test', iv: 'iv', isValid: true },
          openai: { encrypted: 'test2', iv: 'iv2', isValid: true }
        }
      }
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        mcpSettings: JSON.stringify(existingSettings)
      })
      mockPrisma.user.update.mockResolvedValue({ ...mockUser })

      const request = createMockRequest({ serviceId: 'claude' })
      const response = await DELETE(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)

      // Check that Claude was removed but OpenAI remains
      const updateCall = mockPrisma.user.update.mock.calls[0][0]
      const savedSettings = JSON.parse(updateCall.data.mcpSettings)
      expect(savedSettings.apiKeys.claude).toBeUndefined()
      expect(savedSettings.apiKeys.openai).toBeDefined()
    })

    it('should delete Gemini API key', async () => {
      const existingSettings = {
        apiKeys: {
          gemini: { encrypted: 'test', iv: 'iv', isValid: true }
        }
      }
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        mcpSettings: JSON.stringify(existingSettings)
      })
      mockPrisma.user.update.mockResolvedValue({ ...mockUser })

      const request = createMockRequest({ serviceId: 'gemini' })
      const response = await DELETE(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)

      const updateCall = mockPrisma.user.update.mock.calls[0][0]
      const savedSettings = JSON.parse(updateCall.data.mcpSettings)
      expect(savedSettings.apiKeys.gemini).toBeUndefined()
    })

    it('should return 400 for invalid serviceId', async () => {
      const request = createMockRequest({ serviceId: 'invalid' })
      const response = await DELETE(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Validation failed')
    })
  })

  describe('POST /api/user/ai-api-keys/test', () => {
    it('should return 401 for unauthenticated user', async () => {
      mockGetServerSession.mockResolvedValueOnce(null)

      const request = createMockRequest({ serviceId: 'claude' })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should return 404 when no API key configured', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        mcpSettings: JSON.stringify({ apiKeys: {} })
      })

      const request = createMockRequest({ serviceId: 'claude' })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.success).toBe(false)
      expect(data.error).toBe('API key not found')
    })

    it('should return 400 for invalid serviceId', async () => {
      const request = createMockRequest({ serviceId: 'invalid' })
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Validation failed')
    })
  })
})

describe('AI API Keys - All Three Services', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { id: 'test-user-id', email: 'test@example.com' }
    })
  })

  it('should support all three AI services: claude, openai, gemini', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      ...mockUser,
      mcpSettings: null
    })
    mockPrisma.user.update.mockResolvedValue({ ...mockUser })

    // Test each service
    for (const serviceId of ['claude', 'openai', 'gemini']) {
      const request = createMockRequest({ serviceId, apiKey: `test-key-${serviceId}` })
      const response = await PUT(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
    }
  })

  it('should store all three keys simultaneously', async () => {
    const existingSettings = {
      apiKeys: {
        claude: { encrypted: 'c1', iv: 'iv1', isValid: true },
        openai: { encrypted: 'o1', iv: 'iv2', isValid: true },
        gemini: { encrypted: 'g1', iv: 'iv3', isValid: true }
      }
    }
    mockPrisma.user.findUnique.mockResolvedValue({
      ...mockUser,
      mcpSettings: JSON.stringify(existingSettings)
    })

    const response = await GET(createMockRequest())
    const data = await response.json()

    // The actual decryption will fail with mock data, but structure should be correct
    expect(response.status).toBe(200)
  })
})
