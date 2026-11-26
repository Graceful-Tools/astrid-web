/**
 * AWTD-1567: /mcp tool calls reach /api/v1 with the caller's token, so a token
 * held to its scopes is refused there with a 403 naming the scope. The MCP
 * client must pass that name on: "Forbidden" alone tells the owner nothing.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { OAuthAPIClient } from '@/mcp/oauth-api-client'

const realFetch = global.fetch
afterEach(() => {
  global.fetch = realFetch
})

function respond(status: number, body: unknown) {
  global.fetch = vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch
}

describe('AWTD-1567: MCP client surfaces a scope refusal', () => {
  const client = () => new OAuthAPIClient('http://localhost:3000', undefined, undefined, 'astrid_mcp_static')

  it('includes the 403 message that names the missing scope', async () => {
    respond(403, { error: 'Forbidden', message: 'Missing required scopes: tasks:write', missingScopes: ['tasks:write'] })
    await expect(client().makeRequest('/api/v1/tasks', { method: 'POST' })).rejects.toThrow(
      'Forbidden: Missing required scopes: tasks:write'
    )
  })

  it('leaves other errors as they were', async () => {
    respond(404, { error: 'Task not found', message: 'ignored' })
    await expect(client().makeRequest('/api/v1/tasks/x')).rejects.toThrow(/^Task not found$/)
  })
})
