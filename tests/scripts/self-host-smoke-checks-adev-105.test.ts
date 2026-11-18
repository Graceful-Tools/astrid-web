import { describe, it, expect } from 'vitest'
import { mcpSurfaceProbes, resourceMetadataUrl, MCP_DISCOVERY_PATHS } from '../../scripts/lib/self-host-smoke-checks'
import { mcpAuthChallenge } from '../../lib/server/mcp-http-utils'

describe('self-host smoke: MCP surface (ADEV-105)', () => {
  it('ADEV-105: with MCP on, /mcp challenges and both discovery documents are served', () => {
    expect(mcpSurfaceProbes(true)).toEqual([
      { path: '/mcp', method: 'POST', status: 401 },
      { path: MCP_DISCOVERY_PATHS[0], method: 'GET', status: 200 },
      { path: MCP_DISCOVERY_PATHS[1], method: 'GET', status: 200 },
    ])
  })

  it('ADEV-105: with MCP off, all three are absent', () => {
    expect(mcpSurfaceProbes(false).map((probe) => probe.status)).toEqual([404, 404, 404])
  })

  it('ADEV-105: reads resource_metadata from the challenge the server actually sends', () => {
    const base = 'http://localhost:3000'
    const expected = `${base}/.well-known/oauth-protected-resource/mcp`
    expect(resourceMetadataUrl(mcpAuthChallenge(base))).toBe(expected)
    expect(resourceMetadataUrl(mcpAuthChallenge(base, true))).toBe(expected)
  })

  it('ADEV-105: a bare or non-Bearer challenge has no metadata', () => {
    expect(resourceMetadataUrl(null)).toBeNull()
    expect(resourceMetadataUrl('Bearer')).toBeNull()
    expect(resourceMetadataUrl('Basic realm="x", resource_metadata="http://x"')).toBeNull()
  })
})
