import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { RateLimiter } from '@/lib/rate-limiter'
import { NextRequest } from 'next/server'

// Mock NextAuth
vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}))

// Mock Prisma
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}))

// Create mock NextRequest with IP
function createMockRequest(ip: string = '127.0.0.1'): NextRequest {
  return {
    headers: new Headers({
      'x-forwarded-for': ip,
    }),
  } as NextRequest
}

// Generate unique IP for each test to avoid shared state
let ipCounter = 100
function getUniqueIP(): string {
  return `10.1.${Math.floor(ipCounter / 256)}.${ipCounter++ % 256}`
}

describe('Authentication System', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  describe('Rate Limiting', () => {
    it('should allow requests within rate limit', async () => {
      const rateLimiter = new RateLimiter({
        windowMs: 60000,
        maxRequests: 5
      })
      const ip = getUniqueIP()

      // First 5 requests should succeed
      for (let i = 0; i < 5; i++) {
        const result = await rateLimiter.checkRateLimitAsync(createMockRequest(ip))
        expect(result.allowed).toBe(true)
        expect(result.remaining).toBe(4 - i)
      }

      // 6th request should fail
      const result = await rateLimiter.checkRateLimitAsync(createMockRequest(ip))
      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
    })

    it('should reset rate limit after window expires', async () => {
      const rateLimiter = new RateLimiter({
        windowMs: 100,
        maxRequests: 3
      })
      const ip = getUniqueIP()
      const req = createMockRequest(ip)

      // Use up all requests
      for (let i = 0; i < 3; i++) {
        await rateLimiter.checkRateLimitAsync(req)
      }

      // Should be rate limited
      expect((await rateLimiter.checkRateLimitAsync(req)).allowed).toBe(false)

      // Advance time past the window
      vi.advanceTimersByTime(150)

      // Should allow requests again
      const result = await rateLimiter.checkRateLimitAsync(req)
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(2)
    })

    it('should handle multiple IPs independently', async () => {
      const rateLimiter = new RateLimiter({
        windowMs: 60000,
        maxRequests: 3
      })
      const req1 = createMockRequest(getUniqueIP())
      const req2 = createMockRequest(getUniqueIP())

      // Use up all requests for IP1
      for (let i = 0; i < 3; i++) {
        await rateLimiter.checkRateLimitAsync(req1)
      }

      // IP1 should be rate limited
      expect((await rateLimiter.checkRateLimitAsync(req1)).allowed).toBe(false)

      // IP2 should still work
      const result = await rateLimiter.checkRateLimitAsync(req2)
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(2)
    })
  })

  describe('Rate Limiter Response', () => {
    it('should include correct rate limit info in response', async () => {
      const rateLimiter = new RateLimiter({
        windowMs: 60000,
        maxRequests: 5
      })
      const req = createMockRequest(getUniqueIP())

      const result = await rateLimiter.checkRateLimitAsync(req)

      expect(result).toHaveProperty('allowed')
      expect(result).toHaveProperty('remaining')
      expect(result).toHaveProperty('resetTime')
      expect(result).toHaveProperty('total')
      expect(result.total).toBe(5)
    })
  })
})
