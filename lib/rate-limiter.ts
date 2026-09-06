import { NextRequest } from "next/server"
import { RateLimitStore, getCachedRateLimitStore } from "./rate-limit-stores"
import { clientIpKey, getClientIp } from "./client-ip"

interface RateLimitConfig {
  windowMs: number // Time window in milliseconds
  maxRequests: number // Max requests per window
  keyGenerator?: (request: NextRequest) => string // Custom key generator
}

// Keep interface exported for backward compatibility
export interface RateLimitEntry {
  count: number
  resetTime: number
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetTime: number
  total: number
}

export class RateLimiter {
  private config: RateLimitConfig
  private storePromise: Promise<RateLimitStore> | null = null

  constructor(config: RateLimitConfig) {
    this.config = config
  }

  private async getStore(): Promise<RateLimitStore> {
    if (!this.storePromise) {
      this.storePromise = getCachedRateLimitStore()
    }
    return this.storePromise
  }

  private getClientKey(request: NextRequest): string {
    if (this.config.keyGenerator) {
      return this.config.keyGenerator(request)
    }

    // Default: the rightmost trusted X-Forwarded-For hop — see lib/client-ip.ts
    return clientIpKey('ip', request)
  }

  /**
   * Check rate limit against the shared (Redis-backed where available) store.
   *
   * This is the ONLY check. The old synchronous variant counted in a
   * per-instance in-memory Map, so a documented "10 attempts per minute" was
   * really 10 x the number of warm serverless instances and reset on every cold
   * start (task c2fbe8e4).
   */
  public async checkRateLimitAsync(request: NextRequest): Promise<RateLimitResult> {
    return this.checkRateLimitByKeyAsync(this.getClientKey(request))
  }

  /**
   * Redis-backed rate-limit check against an explicit key (e.g. a user id),
   * for handlers that key on identity rather than IP.
   */
  public async checkRateLimitByKeyAsync(key: string): Promise<RateLimitResult> {
    const store = await this.getStore()

    // Get current entry
    const currentEntry = await store.get(key)
    const now = Date.now()

    // Check if we need to increment (within window and under limit)
    if (currentEntry && now <= currentEntry.resetTime) {
      // Within existing window
      if (currentEntry.count >= this.config.maxRequests) {
        // Already at limit, don't increment
        return {
          allowed: false,
          remaining: 0,
          resetTime: currentEntry.resetTime,
          total: this.config.maxRequests
        }
      }
    }

    // Increment the counter
    const entry = await store.increment(key, this.config.windowMs)

    const allowed = entry.count <= this.config.maxRequests

    return {
      allowed,
      remaining: Math.max(0, this.config.maxRequests - entry.count),
      resetTime: entry.resetTime,
      total: this.config.maxRequests
    }
  }
}

// Auth-specific rate limiter (stricter limits for security-sensitive operations)
export const authRateLimiter = new RateLimiter({
  windowMs: 1 * 60 * 1000, // 1 minute
  maxRequests: 10, // 10 auth attempts per minute per IP
})

// OAuth token endpoint - stricter limits to prevent brute force attacks on client credentials
export const oauthTokenRateLimiter = new RateLimiter({
  windowMs: 1 * 60 * 1000, // 1 minute
  maxRequests: 20, // 20 token requests per minute per IP
  keyGenerator: (request) => clientIpKey('oauth', request),
})

export const oauthRegistrationRateLimiter = new RateLimiter({
  windowMs: 60 * 60 * 1000,
  maxRequests: 20,
  keyGenerator: (request) => clientIpKey('oauth-register', request),
})

// Per-user invite rate limit (keyed by user id via checkRateLimitByKeyAsync):
// invites send mail to arbitrary addresses from the Astrid domain, so cap the
// spam blast radius.
export const inviteRateLimiter = new RateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: 30,
})

// Passkey ceremonies. Unauthenticated, they touch the user table by email and
// they mint challenges, so they get a tighter budget than general auth traffic
// (task c2fbe8e4 — these routes previously had no limiter at all).
export const passkeyRateLimiter = new RateLimiter({
  windowMs: 1 * 60 * 1000, // 1 minute
  maxRequests: 10,
  keyGenerator: (request) => clientIpKey('passkey', request),
})

// Session read/teardown endpoints (mobile-session, v1 signout). Called
// routinely by the iOS app, so the budget is generous — it exists to stop a
// cookie-guessing loop, not to police normal use.
export const sessionRateLimiter = new RateLimiter({
  windowMs: 1 * 60 * 1000, // 1 minute
  maxRequests: 60,
  keyGenerator: (request) => clientIpKey('session', request),
})

// Preset configurations for different endpoints
export const RATE_LIMITS = {
  // Webhook endpoints - higher limits for legitimate AI service integrations
  WEBHOOK: new RateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 100, // 100 requests per 15 minutes
    keyGenerator: (request) => {
      // Rate limit by IP and User-Agent combination for webhooks
      const userAgent = request.headers.get('user-agent') || 'unknown'
      return `webhook:${getClientIp(request)}:${userAgent.substring(0, 50)}`
    }
  }),

  // MCP operations - moderate limits for API usage
  MCP_OPERATIONS: new RateLimiter({
    windowMs: 1 * 60 * 1000, // 1 minute
    maxRequests: 100, // 100 requests per minute (allows full sync + task operations)
    keyGenerator: (request) => clientIpKey('mcp', request),
  }),

  // API key testing - strict limits to prevent abuse
  API_KEY_TEST: new RateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 10, // 10 tests per hour
    keyGenerator: (request) => clientIpKey('apitest', request),
  }),

  // General API endpoints
  GENERAL: new RateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 200, // 200 requests per 15 minutes
  }),

  // Public API endpoints - stricter limits to prevent scraping
  PUBLIC: new RateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 60, // 60 requests per 15 minutes (4 per minute)
    keyGenerator: (request) => clientIpKey('public', request),
  })
}

// Helper function to create rate limit response headers
export function createRateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': result.total.toString(),
    'X-RateLimit-Remaining': result.remaining.toString(),
    'X-RateLimit-Reset': Math.ceil(result.resetTime / 1000).toString(), // Unix timestamp
    'X-RateLimit-Reset-After': Math.ceil((result.resetTime - Date.now()) / 1000).toString() // Seconds until reset
  }
}

/**
 * Middleware helper for rate limiting against the shared store.
 */
export function withRateLimitAsync(rateLimiter: RateLimiter) {
  return async (request: NextRequest) => {
    const result = await rateLimiter.checkRateLimitAsync(request)
    const headers = createRateLimitHeaders(result)

    return {
      allowed: result.allowed,
      headers,
      status: result.allowed ? 200 : 429,
      error: result.allowed ? null : {
        error: 'Rate limit exceeded',
        message: `Too many requests. Try again in ${Math.ceil((result.resetTime - Date.now()) / 1000)} seconds.`,
        retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000)
      }
    }
  }
}

/**
 * Higher-order function to wrap an API handler with rate limiting.
 */
export function withRateLimitHandlerAsync(
  handler: (req: NextRequest, ...args: unknown[]) => Promise<Response>,
  rateLimiter: RateLimiter
) {
  return async (req: NextRequest, ...args: unknown[]) => {
    const result = await rateLimiter.checkRateLimitAsync(req)

    if (!result.allowed) {
      return new Response(
        JSON.stringify({
          error: 'Too many requests',
          message: `Rate limit exceeded. Try again in ${Math.ceil((result.resetTime - Date.now()) / 1000)} seconds.`,
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            ...createRateLimitHeaders(result),
            'Retry-After': Math.ceil((result.resetTime - Date.now()) / 1000).toString()
          }
        }
      )
    }

    const response = await handler(req, ...args)

    // Add rate limit headers to successful responses
    if (response instanceof Response) {
      const headers = createRateLimitHeaders(result)
      Object.entries(headers).forEach(([key, value]) => {
        response.headers.set(key, value)
      })
    }

    return response
  }
}
