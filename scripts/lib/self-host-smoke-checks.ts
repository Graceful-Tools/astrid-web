/**
 * Pure halves of the self-host smoke test's MCP checks (ADEV-105), so the
 * expectations are unit-tested without a running stack
 * (tests/scripts/self-host-smoke-checks-adev-105.test.ts).
 */

export interface McpSurfaceProbe {
  path: string
  method: 'GET' | 'POST'
  /** The status a deployment with this MCP setting must answer. */
  status: number
}

/** The OAuth discovery documents an MCP client reads before it signs in. */
export const MCP_DISCOVERY_PATHS = [
  '/.well-known/oauth-protected-resource/mcp',
  '/.well-known/oauth-authorization-server',
] as const

/**
 * What `/mcp` and its discovery documents answer an unauthenticated caller.
 * MCP on: the endpoint challenges (401) and the documents are served (200).
 * MCP off (`integrations.mcp: false` in /api/v1/capabilities): all three are
 * absent (404), so the deployment advertises nothing it does not offer.
 */
export function mcpSurfaceProbes(mcpEnabled: boolean): McpSurfaceProbe[] {
  return [
    { path: '/mcp', method: 'POST', status: mcpEnabled ? 401 : 404 },
    ...MCP_DISCOVERY_PATHS.map((path) => ({ path, method: 'GET' as const, status: mcpEnabled ? 200 : 404 })),
  ]
}

/**
 * The `resource_metadata` URL in an MCP `WWW-Authenticate` challenge
 * (lib/server/mcp-http-utils.ts mcpAuthChallenge), or null when there is none.
 * Without it a client gets a bare 401 and cannot discover how to sign in.
 */
export function resourceMetadataUrl(challenge: string | null): string | null {
  if (!challenge || !/^Bearer\s/i.test(challenge)) return null
  return challenge.match(/\bresource_metadata="([^"]+)"/)?.[1] ?? null
}
