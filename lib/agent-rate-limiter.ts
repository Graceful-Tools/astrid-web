/**
 * Per-client rate limiting for agent protocol endpoints.
 *
 * Keys by OAuth clientId (falls back to IP when unavailable).
 * Uses the existing RateLimiter infrastructure with Redis/memory stores.
 */

import { NextRequest, NextResponse } from 'next/server'
import { RateLimiter, createRateLimitHeaders } from './rate-limiter'
import type { AuthContext } from './api-auth-middleware'

function agentKeyGenerator(endpointTag: string) {
  return (request: NextRequest): string => {
    const clientId = (request as any).__agentClientId
    if (clientId) {
      return `agent:${endpointTag}:${clientId}`
    }
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
               request.headers.get('x-real-ip') || 'unknown'
    return `agent:${endpointTag}:ip:${ip}`
  }
}

export const AGENT_RATE_LIMITS = {
  /** Tasks endpoints: 100 req/min per client */
  TASKS: new RateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 100,
    keyGenerator: agentKeyGenerator('tasks'),
  }),

  /** Comments endpoints: 30 req/min per client */
  COMMENTS: new RateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 30,
    keyGenerator: agentKeyGenerator('comments'),
  }),

  /** SSE connections: 5 per client per minute */
  SSE: new RateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 5,
    keyGenerator: agentKeyGenerator('sse'),
  }),

  /** Registration: 5 per hour per user */
  REGISTRATION: new RateLimiter({
    windowMs: 60 * 60 * 1000,
    maxRequests: 5,
    keyGenerator: (request: NextRequest) => {
      const userId = (request as any).__agentUserId
      if (userId) return `agent:register:${userId}`
      const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
                 request.headers.get('x-real-ip') || 'unknown'
      return `agent:register:ip:${ip}`
    },
  }),
}

/**
 * Check per-client rate limit. Call after authentication.
 * Returns a 429 response if rate-limited, or null if allowed.
 * Always returns rate limit headers to attach to the response.
 */
export async function checkAgentRateLimit(
  request: NextRequest,
  auth: AuthContext,
  limiter: RateLimiter
): Promise<{ response: NextResponse | null; headers: Record<string, string> }> {
  ;(request as any).__agentClientId = auth.clientId
  ;(request as any).__agentUserId = auth.userId

  const result = await limiter.checkRateLimitAsync(request)
  const headers = createRateLimitHeaders(result)

  if (!result.allowed) {
    const retryAfter = Math.ceil((result.resetTime - Date.now()) / 1000)
    return {
      response: NextResponse.json(
        {
          error: 'Rate limit exceeded',
          retryAfter,
        },
        {
          status: 429,
          headers: { ...headers, 'Retry-After': retryAfter.toString() },
        }
      ),
      headers,
    }
  }

  return { response: null, headers }
}

/** Add rate limit headers to a successful response. */
export function addRateLimitHeaders(
  response: NextResponse,
  headers: Record<string, string>
): NextResponse {
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value)
  }
  return response
}
