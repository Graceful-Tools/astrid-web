import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { RateLimiter } from '../../lib/rate-limiter'
import { NextRequest } from 'next/server'

// Helper to create mock NextRequest with specific IP
function createMockRequest(ip: string = '127.0.0.1'): NextRequest {
  return {
    headers: new Headers({
      'x-forwarded-for': ip,
    }),
  } as NextRequest
}

// Generate unique IP for each test to avoid shared state
let ipCounter = 0
function getUniqueIP(): string {
  return `10.0.${Math.floor(ipCounter / 256)}.${ipCounter++ % 256}`
}

describe('Rate Limiting - Simple Tests', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Basic Rate Limiting', () => {
    it('should allow requests within limit', async () => {
      const rateLimiter = new RateLimiter({ windowMs: 60000, maxRequests: 5 })
      const ip = getUniqueIP()
      const req = createMockRequest(ip)

      // First 5 requests should succeed
      for (let i = 0; i < 5; i++) {
        const result = await rateLimiter.checkRateLimitAsync(req)
        expect(result.allowed).toBe(true)
        expect(result.remaining).toBe(4 - i)
        expect(result.total).toBe(5)
      }
    })

    it('should block requests exceeding limit', async () => {
      const rateLimiter = new RateLimiter({ windowMs: 60000, maxRequests: 3 })
      const ip = getUniqueIP()
      const req = createMockRequest(ip)

      // First 3 requests should succeed
      for (let i = 0; i < 3; i++) {
        const result = await rateLimiter.checkRateLimitAsync(req)
        expect(result.allowed).toBe(true)
      }

      // 4th request should fail
      const result = await rateLimiter.checkRateLimitAsync(req)
      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
      expect(result.total).toBe(3)
    })

    it('should handle multiple IPs independently', async () => {
      const rateLimiter = new RateLimiter({ windowMs: 60000, maxRequests: 2 })
      const req1 = createMockRequest(getUniqueIP())
      const req2 = createMockRequest(getUniqueIP())

      // Use up rate limit for IP1
      await rateLimiter.checkRateLimitAsync(req1)
      await rateLimiter.checkRateLimitAsync(req1)
      const blocked1 = await rateLimiter.checkRateLimitAsync(req1)
      expect(blocked1.allowed).toBe(false)

      // IP2 should still work
      const result2 = await rateLimiter.checkRateLimitAsync(req2)
      expect(result2.allowed).toBe(true)
      expect(result2.remaining).toBe(1)
    })
  })

  describe('Rate Limiter Configuration', () => {
    it('should respect custom configuration', async () => {
      const customRateLimiter = new RateLimiter({
        windowMs: 5000, // 5 seconds
        maxRequests: 10,
      })
      const ip = getUniqueIP()
      const req = createMockRequest(ip)

      const result = await customRateLimiter.checkRateLimitAsync(req)
      expect(result.allowed).toBe(true)
      expect(result.total).toBe(10)
      expect(result.remaining).toBe(9)
    })
  })

  describe('Rate Limit Reset', () => {
    it('should calculate reset time correctly', async () => {
      const rateLimiter = new RateLimiter({ windowMs: 60000, maxRequests: 5 })
      const ip = getUniqueIP()
      const req = createMockRequest(ip)

      const result = await rateLimiter.checkRateLimitAsync(req)
      expect(result.resetTime).toBeGreaterThanOrEqual(Date.now())
      expect(result.resetTime).toBeLessThanOrEqual(Date.now() + 60000) // Within 1 minute
    })

    it('should reset after window expires', async () => {
      const rateLimiter = new RateLimiter({ windowMs: 100, maxRequests: 2 })
      const ip = getUniqueIP()
      const req = createMockRequest(ip)

      // Use up rate limit
      await rateLimiter.checkRateLimitAsync(req)
      await rateLimiter.checkRateLimitAsync(req)
      expect((await rateLimiter.checkRateLimitAsync(req)).allowed).toBe(false)

      // Advance time past window
      vi.advanceTimersByTime(150)

      // Should allow again
      expect((await rateLimiter.checkRateLimitAsync(req)).allowed).toBe(true)
    })
  })

  describe('Edge Cases', () => {
    it('should handle zero max requests', async () => {
      const rateLimiter = new RateLimiter({ windowMs: 60000, maxRequests: 0 })
      const ip = getUniqueIP()
      const req = createMockRequest(ip)

      const result = await rateLimiter.checkRateLimitAsync(req)
      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
      expect(result.total).toBe(0)
    })

    it('should handle very high max requests', async () => {
      const rateLimiter = new RateLimiter({ windowMs: 60000, maxRequests: 1000 })
      const ip = getUniqueIP()
      const req = createMockRequest(ip)

      const result = await rateLimiter.checkRateLimitAsync(req)
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(999)
      expect(result.total).toBe(1000)
    })
  })
})
