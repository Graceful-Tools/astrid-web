/**
 * Task e58bf2c1 — scripts/validate-mcp-oauth.ts must distinguish Cloudflare
 * error 1010 (browser_signature_banned) from bad credentials: the 1010 is
 * bot/TLS-fingerprint blocking, and the fix is a different HTTP client
 * (curl works where Python urllib fails), not a credential rotation.
 */
import { describe, it, expect } from 'vitest'
import { detectCloudflareBlock } from '@/scripts/validate-mcp-oauth'

function cloudflare1010Response(): Response {
  const html = [
    '<html><head><title>Attention Required! | Cloudflare</title></head><body>',
    '<div class="cf-error-details-wrapper">',
    '<span class="cf-error-code">error code: 1010</span>',
    '<!-- browser_signature_banned -->',
    '</div></body></html>',
  ].join('\n')
  return new Response(html, {
    status: 403,
    headers: { 'cf-ray': 'abc123def456', 'content-type': 'text/html' },
  })
}

describe('validate-mcp-oauth Cloudflare detection (task e58bf2c1)', () => {
  it('flags a 403 carrying error 1010 as bot blocking, not bad credentials', async () => {
    const detail = await detectCloudflareBlock(cloudflare1010Response())

    expect(detail).toBeTruthy()
    expect(detail).toMatch(/1010/)
    expect(detail).toMatch(/not invalid credentials/i)
    expect(detail).toMatch(/curl/i)
  })

  it('returns null for a JSON invalid_client 401', async () => {
    const res = new Response(JSON.stringify({ error: 'invalid_client' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })

    expect(await detectCloudflareBlock(res)).toBeNull()
  })

  it('returns null for a plain 403 without the 1010 signature', async () => {
    const res = new Response('Forbidden', { status: 403 })

    expect(await detectCloudflareBlock(res)).toBeNull()
  })

  it('does not consume the response body', async () => {
    const res = cloudflare1010Response()

    await detectCloudflareBlock(res)

    // The caller still needs the body for its own error reporting.
    expect(await res.text()).toContain('1010')
  })
})
