/**
 * AWTD-1693 — get_orchestration_policy: an agent reads what it may do from the stored policy.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AstridMCPServerOAuth from '@/mcp/mcp-server-oauth'
import { OAUTH_MCP_TOOLS } from '@/mcp/tool-definitions'
import { defaultOrchestrationPolicy, resolvePolicy } from '@/lib/orchestration-policy'

async function callTool(server: AstridMCPServerOAuth, name: string, args: unknown) {
  const handler = (server as any).server._requestHandlers.get('tools/call')
  return handler({ method: 'tools/call', params: { name, arguments: args } }, {})
}

function stubRoutes(routes: Record<string, unknown>) {
  const fetchMock = vi.fn(async (url: string) => {
    const path = new URL(url).pathname
    const body = routes[path]
    return { ok: body !== undefined, status: body === undefined ? 404 : 200, statusText: '', json: async () => body ?? { error: 'nf' } }
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const permissive = resolvePolicy({ autonomy: { merge: 'allowed', deploy: 'allowed' } }, null)
const asking = resolvePolicy({ autonomy: { merge: 'ask', deploy: 'allowed' } }, null)

describe('get_orchestration_policy (AWTD-1693)', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('is advertised, read-only, and takes listId or taskId', () => {
    const tool = OAUTH_MCP_TOOLS.find(t => t.name === 'get_orchestration_policy')
    expect(tool).toBeDefined()
    expect(Object.keys(tool!.inputSchema.properties)).toEqual(['listId', 'taskId'])
    expect(OAUTH_MCP_TOOLS.some(t => /set_orchestration|update_orchestration/.test(t.name))).toBe(false)
  })

  it('reads one list\'s policy', async () => {
    const fetchMock = stubRoutes({ '/api/v1/lists/l1/orchestration-policy': { listId: 'l1', effective: defaultOrchestrationPolicy() } })
    const result = await callTool(new AstridMCPServerOAuth({ accessToken: 'astrid_mcp_test' }), 'get_orchestration_policy', { listId: 'l1' })
    expect(result.isError).toBeFalsy()
    expect(JSON.parse(result.content[0].text).effective.autonomy.merge).toBe('never')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('for a task on two lists, answers each and the strictest across them', async () => {
    stubRoutes({
      '/api/v1/tasks/AWTD-1': { task: { id: 't1', listIds: ['a', 'b'] } },
      '/api/v1/lists/a/orchestration-policy': { listId: 'a', effective: permissive },
      '/api/v1/lists/b/orchestration-policy': { listId: 'b', effective: asking },
    })
    const result = await callTool(new AstridMCPServerOAuth({ accessToken: 'astrid_mcp_test' }), 'get_orchestration_policy', { taskId: 'AWTD-1' })
    const body = JSON.parse(result.content[0].text)
    expect(body.lists.map((l: { listId: string }) => l.listId)).toEqual(['a', 'b'])
    expect(body.strictest).toMatchObject({ merge: 'ask', deploy: 'allowed', release: 'never' })
  })

  it('refuses a call naming neither', async () => {
    stubRoutes({})
    const result = await callTool(new AstridMCPServerOAuth({ accessToken: 'astrid_mcp_test' }), 'get_orchestration_policy', {})
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('listId or taskId')
  })
})
