/**
 * RED for the Cloudflare-proxy cutover (2026-09-13): with astrid.cc proxied by
 * Cloudflare, Vercel overwrites X-Forwarded-For with the Cloudflare edge that
 * connected to it, so every trusted-hop lookup keyed rate limits on a handful
 * of Cloudflare addresses shared by all users. The real client is in
 * cf-connecting-ip — but only when the trusted hop really is a Cloudflare
 * edge, otherwise anyone reaching Vercel directly could forge it.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { getClientIp, isCloudflareIp } from '@/lib/client-ip'

function req(headers: Record<string, string>): NextRequest {
  return { headers: new Headers(headers) } as NextRequest
}

// Cloudflare edge address (172.64.0.0/13) — what Vercel writes into
// x-forwarded-for when the request came through the Cloudflare proxy.
const CF_EDGE = '172.70.42.9'

const originalDepth = process.env.TRUSTED_PROXY_DEPTH

afterEach(() => {
  if (originalDepth === undefined) delete process.env.TRUSTED_PROXY_DEPTH
  else process.env.TRUSTED_PROXY_DEPTH = originalDepth
})

describe('isCloudflareIp', () => {
  it('matches addresses inside the published Cloudflare IPv4 ranges', () => {
    expect(isCloudflareIp('172.70.42.9')).toBe(true)     // 172.64.0.0/13
    expect(isCloudflareIp('104.16.0.1')).toBe(true)      // 104.16.0.0/13
    expect(isCloudflareIp('162.158.255.255')).toBe(true) // 162.158.0.0/15
    expect(isCloudflareIp('131.0.72.1')).toBe(true)      // 131.0.72.0/22
  })

  it('rejects addresses outside the ranges, garbage, and IPv6', () => {
    expect(isCloudflareIp('76.76.21.21')).toBe(false)
    expect(isCloudflareIp('131.0.76.1')).toBe(false) // just past 131.0.72.0/22
    expect(isCloudflareIp('203.0.113.7')).toBe(false)
    expect(isCloudflareIp('not-an-ip')).toBe(false)
    expect(isCloudflareIp('300.1.1.1')).toBe(false)
    expect(isCloudflareIp('2606:4700::1')).toBe(false)
    expect(isCloudflareIp('')).toBe(false)
  })
})

describe('getClientIp behind the Cloudflare proxy', () => {
  it('uses cf-connecting-ip when the trusted hop is a Cloudflare edge', () => {
    const r = req({ 'x-forwarded-for': CF_EDGE, 'cf-connecting-ip': '203.0.113.7' })
    expect(getClientIp(r)).toBe('203.0.113.7')
  })

  it('still ignores a spoofed leftmost entry in front of the Cloudflare hop', () => {
    const r = req({ 'x-forwarded-for': `9.9.9.9, ${CF_EDGE}`, 'cf-connecting-ip': '203.0.113.7' })
    expect(getClientIp(r)).toBe('203.0.113.7')
  })

  it('ignores a forged cf-connecting-ip when the trusted hop is not Cloudflare', () => {
    // Direct-to-Vercel request with a spoofed header: keep keying on the real peer.
    const r = req({ 'x-forwarded-for': '198.51.100.4', 'cf-connecting-ip': '203.0.113.7' })
    expect(getClientIp(r)).toBe('198.51.100.4')
  })

  it('falls back to the Cloudflare edge address if cf-connecting-ip is missing or blank', () => {
    expect(getClientIp(req({ 'x-forwarded-for': CF_EDGE }))).toBe(CF_EDGE)
    expect(getClientIp(req({ 'x-forwarded-for': CF_EDGE, 'cf-connecting-ip': '  ' }))).toBe(CF_EDGE)
  })

  it('applies the same rule when the peer arrives via x-real-ip', () => {
    expect(getClientIp(req({ 'x-real-ip': CF_EDGE, 'cf-connecting-ip': '203.0.113.7' }))).toBe('203.0.113.7')
    expect(getClientIp(req({ 'x-real-ip': '198.51.100.4', 'cf-connecting-ip': '203.0.113.7' }))).toBe('198.51.100.4')
  })

  it('respects TRUSTED_PROXY_DEPTH before deciding whether the hop is Cloudflare', () => {
    process.env.TRUSTED_PROXY_DEPTH = '2'
    // Trusted hop (depth 2) is the client; the Cloudflare address is the inner proxy.
    const r = req({ 'x-forwarded-for': `198.51.100.4, ${CF_EDGE}`, 'cf-connecting-ip': '203.0.113.7' })
    expect(getClientIp(r)).toBe('198.51.100.4')
  })
})
