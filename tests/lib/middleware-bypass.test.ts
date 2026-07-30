/**
 * Regression for task a0e0808c — the hosted MCP endpoint 404'd.
 *
 * next-intl rewrites any path not bypassed to a /[locale]/... page. /mcp and
 * /mcp/messages were not bypassed, so they were rewritten to a non-existent
 * locale page (404) and the next.config `/mcp -> /api/mcp` rewrite never applied
 * — making the documented MCP server URL unreachable.
 */
import { describe, it, expect } from 'vitest'
import { shouldBypassIntlRouting } from '@/lib/middleware-bypass'

describe('shouldBypassIntlRouting (task a0e0808c)', () => {
  it('bypasses the MCP endpoints so the /mcp -> /api/mcp rewrite can apply', () => {
    expect(shouldBypassIntlRouting('/mcp')).toBe(true)
    expect(shouldBypassIntlRouting('/mcp/messages')).toBe(true)
  })

  it('still bypasses API, well-known, and PWA files', () => {
    expect(shouldBypassIntlRouting('/api/mcp')).toBe(true)
    expect(shouldBypassIntlRouting('/.well-known/oauth-protected-resource/mcp')).toBe(true)
    expect(shouldBypassIntlRouting('/sw.js')).toBe(true)
    expect(shouldBypassIntlRouting('/manifest.json')).toBe(true)
  })

  it('does NOT over-match the localized settings pages', () => {
    // These are real /[locale] pages and must still go through next-intl.
    expect(shouldBypassIntlRouting('/mcp-operations')).toBe(false)
    expect(shouldBypassIntlRouting('/mcp-testing')).toBe(false)
    expect(shouldBypassIntlRouting('/settings/mcp-access')).toBe(false)
  })

  it('does not bypass ordinary localized routes', () => {
    expect(shouldBypassIntlRouting('/')).toBe(false)
    expect(shouldBypassIntlRouting('/lists/abc')).toBe(false)
  })
})

/**
 * Regression for task 97208a72 — same failure mode as a0e0808c, different path.
 *
 * app/llms.txt/route.ts serves the LLM-readable integration guide, and
 * WELL_KNOWN_ENDPOINTS advertises /llms.txt to agents. But the path was never added
 * to the bypass list, so next-intl rewrote it to /[locale]/llms.txt — a page that
 * does not exist. Verified against production: https://astrid.cc/llms.txt returned
 * the 404 page, not the guide.
 */
describe('shouldBypassIntlRouting for /llms.txt (task 97208a72)', () => {
  it('bypasses /llms.txt so the route handler is reached', () => {
    expect(shouldBypassIntlRouting('/llms.txt')).toBe(true)
  })

  it('does not over-match a localized page that merely starts with the same text', () => {
    expect(shouldBypassIntlRouting('/llms')).toBe(false)
    expect(shouldBypassIntlRouting('/llms.txt-guide')).toBe(false)
  })
})
