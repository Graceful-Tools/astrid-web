/**
 * Paths that must bypass next-intl locale routing in middleware.ts.
 *
 * next-intl rewrites everything else to a `/[locale]/...` path. Anything that is
 * NOT a localized page — API routes, well-known metadata, PWA files, and the
 * MCP endpoints — must be listed here, otherwise it gets rewritten to a locale
 * path that has no page and 404s, which also shadows the next.config rewrites.
 *
 * Task a0e0808c: `/mcp` and `/mcp/messages` were missing here, so the documented
 * MCP endpoint 404'd and the `/mcp -> /api/mcp` rewrite never applied. Note the
 * exact-match / trailing-slash checks for `/mcp` so we don't also swallow the
 * localized settings pages `/mcp-operations`, `/mcp-testing`, `/mcp-access`.
 *
 * Task 97208a72: `/llms.txt` had the same problem — it is advertised to agents in
 * WELL_KNOWN_ENDPOINTS but was rewritten to `/[locale]/llms.txt` and 404'd.
 */
export function shouldBypassIntlRouting(pathname: string): boolean {
  return (
    pathname.startsWith('/api') ||
    pathname.startsWith('/.well-known') ||
    pathname === '/mcp' ||
    pathname.startsWith('/mcp/') ||
    pathname === '/sw.js' ||
    pathname === '/manifest.json' ||
    pathname === '/llms.txt'
  )
}
