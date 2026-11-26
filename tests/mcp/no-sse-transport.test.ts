/**
 * ADEV-303 — the self-host MCP binary was the last place the legacy SSE
 * transport lived (hosted /mcp retired it in AWTD-1569). It was deleted, not
 * ported: nothing in deploy/, Docker or CI ran it. Keep SSE from coming back.
 */
import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'

describe('no legacy MCP SSE transport (ADEV-303)', () => {
  it('has no SSEServerTransport in tracked source', () => {
    const hits = execSync(
      "git grep -l SSEServerTransport -- ':!tests/mcp/no-sse-transport.test.ts' || true",
      { encoding: 'utf8' }
    )
      .split('\n')
      .filter(Boolean)
    expect(hits).toEqual([])
  })

  it('no longer ships the self-host SSE entry point', () => {
    expect(existsSync('mcp/mcp-server-oauth-http.ts')).toBe(false)
  })
})
