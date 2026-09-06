/**
 * RED for task c2fbe8e4 — rate-limit keys were derived from the LEFTMOST
 * X-Forwarded-For entry, which is fully client-controlled behind any proxy
 * that appends rather than overwrites. Vercel happens to overwrite the header,
 * so production was safe by accident; a whitelabel partner running behind
 * their own proxy was handed a limiter an attacker can rotate at will.
 *
 * The client IP must come from the rightmost hop we actually trust, with the
 * number of trusted hops configured by TRUSTED_PROXY_DEPTH (default 1).
 */
import { describe, it, expect, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { getClientIp } from '@/lib/client-ip'

function req(headers: Record<string, string>): NextRequest {
  return { headers: new Headers(headers) } as NextRequest
}

const originalDepth = process.env.TRUSTED_PROXY_DEPTH

afterEach(() => {
  if (originalDepth === undefined) delete process.env.TRUSTED_PROXY_DEPTH
  else process.env.TRUSTED_PROXY_DEPTH = originalDepth
})

describe('getClientIp (task c2fbe8e4)', () => {
  it('ignores a spoofed leftmost entry and uses the trusted hop', () => {
    // Attacker sends "9.9.9.9"; the trusted proxy appends the real peer.
    expect(getClientIp(req({ 'x-forwarded-for': '9.9.9.9, 203.0.113.7' }))).toBe('203.0.113.7')
  })

  it('handles the Vercel case where the header holds only the client IP', () => {
    expect(getClientIp(req({ 'x-forwarded-for': '203.0.113.7' }))).toBe('203.0.113.7')
  })

  it('honours TRUSTED_PROXY_DEPTH for deeper proxy chains', () => {
    process.env.TRUSTED_PROXY_DEPTH = '2'
    expect(getClientIp(req({ 'x-forwarded-for': '9.9.9.9, 203.0.113.7, 10.0.0.1' }))).toBe('203.0.113.7')
  })

  it('never runs off the front of a chain shorter than the configured depth', () => {
    process.env.TRUSTED_PROXY_DEPTH = '5'
    expect(getClientIp(req({ 'x-forwarded-for': '203.0.113.7' }))).toBe('203.0.113.7')
  })

  it('falls back to x-real-ip, then to a constant', () => {
    expect(getClientIp(req({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4')
    expect(getClientIp(req({}))).toBe('unknown')
  })

  it('tolerates whitespace and empty entries', () => {
    expect(getClientIp(req({ 'x-forwarded-for': ' 9.9.9.9 ,  203.0.113.7 , ' }))).toBe('203.0.113.7')
  })
})
