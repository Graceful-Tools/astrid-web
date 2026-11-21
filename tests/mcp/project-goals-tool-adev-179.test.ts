/**
 * ADEV-179 — get_project_goals: an agent reads the project's goals and guardrails over MCP.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AstridMCPServerOAuth from '@/mcp/mcp-server-oauth'
import { OAUTH_MCP_TOOLS } from '@/mcp/tool-definitions'

async function callTool(server: AstridMCPServerOAuth, name: string, args: unknown) {
  const handler = (server as any).server._requestHandlers.get('tools/call')
  return handler({ method: 'tools/call', params: { name, arguments: args } }, {})
}

function stubRoutes(routes: Record<string, unknown>) {
  const fetchMock = vi.fn(async (url: string) => {
    const body = routes[new URL(url).pathname]
    return { ok: body !== undefined, status: body === undefined ? 404 : 200, statusText: '', json: async () => body ?? { error: 'nf' } }
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const goals = { goals: [{ id: 'g', statement: 'Be fast' }], guardrails: [{ id: 'r', statement: 'Break no laws', kind: 'stated' }] }

describe('get_project_goals (ADEV-179)', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('is advertised, read-only, and takes listId or taskId', () => {
    const tool = OAUTH_MCP_TOOLS.find(t => t.name === 'get_project_goals')
    expect(tool).toBeDefined()
    expect(Object.keys(tool!.inputSchema.properties)).toEqual(['listId', 'taskId'])
    expect(OAUTH_MCP_TOOLS.some(t => /set_project_goals|update_project_goals/.test(t.name))).toBe(false)
  })

  it('reads one list\'s goals and adds the text to put in a prompt', async () => {
    stubRoutes({ '/api/v1/lists/l1/goals': { listId: 'l1', projectId: 'p1', goals } })
    const result = await callTool(new AstridMCPServerOAuth({ accessToken: 'astrid_mcp_test' }), 'get_project_goals', { listId: 'l1' })
    expect(result.isError).toBeFalsy()
    const body = JSON.parse(result.content[0].text)
    expect(body.goals).toEqual(goals)
    expect(body.text).toContain('Goals (work toward these):')
    expect(body.text).toContain('- Break no laws')
  })

  it('for a task, answers each list it is on', async () => {
    stubRoutes({
      '/api/v1/tasks/AWTD-1': { task: { id: 't1', listIds: ['a', 'b'] } },
      '/api/v1/lists/a/goals': { listId: 'a', projectId: 'p', goals },
      '/api/v1/lists/b/goals': { listId: 'b', projectId: null, goals: null },
    })
    const result = await callTool(new AstridMCPServerOAuth({ accessToken: 'astrid_mcp_test' }), 'get_project_goals', { taskId: 'AWTD-1' })
    const body = JSON.parse(result.content[0].text)
    expect(body.lists.map((l: { listId: string }) => l.listId)).toEqual(['a', 'b'])
    expect(body.lists[1].text).toBe('')
  })

  it('needs a listId or a taskId', async () => {
    const result = await callTool(new AstridMCPServerOAuth({ accessToken: 'astrid_mcp_test' }), 'get_project_goals', {})
    expect(result.isError).toBe(true)
  })
})
