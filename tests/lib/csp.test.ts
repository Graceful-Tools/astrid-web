/**
 * Task eea00b1b — the acceptance criterion: no 'unsafe-inline' in script-src.
 *
 * The policy lived in next.config.mjs as a static header with
 * `script-src 'self' 'unsafe-inline' … https://unpkg.com`. That directive
 * permits exactly the injected script a CSP exists to stop, and unpkg serves
 * arbitrary npm contents — allowed only because public/sw.js pulled Dexie from
 * there, i.e. a third party could execute code in every user's service worker.
 *
 * Verified end to end against a production build before landing: all 23 script
 * tags on a rendered page carry the single nonce from the response header.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildContentSecurityPolicy, generateNonce } from '@/lib/csp'

function scriptSrc(policy: string): string {
  return policy.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src')) ?? ''
}

describe('Content Security Policy (task eea00b1b)', () => {
  it('has no unsafe-inline in script-src', () => {
    for (const isProduction of [true, false]) {
      expect(scriptSrc(buildContentSecurityPolicy('abc123', isProduction)))
        .not.toContain("'unsafe-inline'")
    }
  })

  it('does not allow unpkg, or any other npm CDN, to serve script', () => {
    const policy = buildContentSecurityPolicy('abc123', true)
    expect(policy).not.toContain('unpkg.com')
    expect(policy).not.toContain('cdn.jsdelivr.net')
  })

  it('carries the request nonce and strict-dynamic', () => {
    const src = scriptSrc(buildContentSecurityPolicy('abc123', true))
    expect(src).toContain(`'nonce-abc123'`)
    // Without strict-dynamic the nonce covers only Next's bootstrap scripts and
    // every chunk it loads would be blocked.
    expect(src).toContain(`'strict-dynamic'`)
  })

  it('allows unsafe-eval only outside production', () => {
    // React Refresh needs it in dev; shipping it would undo much of the above.
    expect(scriptSrc(buildContentSecurityPolicy('n', false))).toContain(`'unsafe-eval'`)
    expect(scriptSrc(buildContentSecurityPolicy('n', true))).not.toContain(`'unsafe-eval'`)
  })

  it('keeps the non-script protections', () => {
    const policy = buildContentSecurityPolicy('n', true)
    expect(policy).toContain(`object-src 'none'`)
    expect(policy).toContain(`base-uri 'self'`)
    expect(policy).toContain(`frame-ancestors 'self'`)
    expect(policy).toContain(`form-action 'self'`)
    expect(policy).toContain('upgrade-insecure-requests')
  })

  it('generates a distinct, non-trivial nonce each time', () => {
    // A reused nonce is a guessable nonce, which is no nonce at all.
    const nonces = new Set(Array.from({ length: 50 }, () => generateNonce()))
    expect(nonces.size).toBe(50)
    for (const nonce of nonces) expect(nonce.length).toBeGreaterThanOrEqual(16)
  })

  it('is not also defined as a static header in next.config.mjs', () => {
    // A static header would win over the middleware's and silently restore
    // 'unsafe-inline'.
    const config = readFileSync(join(process.cwd(), 'next.config.mjs'), 'utf8')
    expect(config).not.toMatch(/key:\s*'Content-Security-Policy'/)
  })
})

describe('the service worker runs no third-party code (task eea00b1b)', () => {
  it('imports Dexie from this origin, not a CDN', () => {
    const sw = readFileSync(join(process.cwd(), 'public/sw.js'), 'utf8')

    // The comment explaining WHY mentions unpkg, so match the import itself
    // rather than the string anywhere in the file.
    const remoteImports = [...sw.matchAll(/importScripts\(\s*['"]([^'"]+)['"]/g)]
      .map((m) => m[1])
      .filter((url) => /^https?:/.test(url))
    expect(remoteImports).toEqual([])
    expect(sw).toContain(`importScripts('/vendor/dexie.min.js')`)
  })

  it('ships the vendored copy the service worker imports', () => {
    const vendored = readFileSync(join(process.cwd(), 'public/vendor/dexie.min.js'), 'utf8')
    expect(vendored.length).toBeGreaterThan(1000)
  })
})
