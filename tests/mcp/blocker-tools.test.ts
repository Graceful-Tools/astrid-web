/**
 * AWTD-1086 — "waiting on" is settable over MCP.
 *
 * Blockers (AWTD-1002) had a v1 API and no MCP tool, so an agent could READ
 * `blockedBy` through get_task and could not write it. The only way left to
 * park a task on another was a `BLOCKED-BY:` comment line — which the queue
 * sweep honours, but which no other surface (the task's "Waiting on" row, the
 * iOS app) shows.
 */
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import AstridMCPServerOAuth from '@/mcp/mcp-server-oauth'
import { OAUTH_MCP_TOOLS } from '@/mcp/tool-definitions'

function stubFetch(json: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => json })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** Through the real CallTool handler, so the dispatch is under test too. */
async function callTool(server: AstridMCPServerOAuth, name: string, args: unknown) {
  const handler = (server as any).server._requestHandlers.get('tools/call')
  return handler({ method: 'tools/call', params: { name, arguments: args } }, {})
}

const urlOf = (fetchMock: Mock, i = 0) => String(fetchMock.mock.calls[i][0])
const initOf = (fetchMock: Mock, i = 0) => fetchMock.mock.calls[i][1] as RequestInit

describe('MCP blocker tools (AWTD-1086)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('advertises add_blocker and remove_blocker', () => {
    const names = OAUTH_MCP_TOOLS.map(t => t.name)
    expect(names).toContain('add_blocker')
    expect(names).toContain('remove_blocker')
  })

  it('add_blocker POSTs the blocking task to the blocked task\'s blockers', async () => {
    const fetchMock = stubFetch({ taskId: 't7', blockingTaskId: 't9', blockedBy: [] })
    const server = new AstridMCPServerOAuth({ accessToken: 'astrid_mcp_test' })

    const result = await callTool(server, 'add_blocker', {
      taskId: 'AWTD-7',
      blockingTaskId: 'AWTD-9',
    })

    expect(result.isError).toBeFalsy()
    expect(urlOf(fetchMock)).toMatch(/\/api\/v1\/tasks\/AWTD-7\/blockers$/)
    expect(initOf(fetchMock).method).toBe('POST')
    expect(JSON.parse(String(initOf(fetchMock).body))).toEqual({ blockingTaskId: 'AWTD-9' })
    expect(JSON.parse(result.content[0].text)).toMatchObject({ success: true, blockedBy: [] })
  })

  it('remove_blocker DELETEs the one link', async () => {
    const fetchMock = stubFetch({ taskId: 't7', blockingTaskId: 't9', blockedBy: [] })
    const server = new AstridMCPServerOAuth({ accessToken: 'astrid_mcp_test' })

    const result = await callTool(server, 'remove_blocker', {
      taskId: 'AWTD-7',
      blockingTaskId: 'AWTD-9',
    })

    expect(result.isError).toBeFalsy()
    expect(urlOf(fetchMock)).toMatch(/\/api\/v1\/tasks\/AWTD-7\/blockers\/AWTD-9$/)
    expect(initOf(fetchMock).method).toBe('DELETE')
  })

  it('refuses a call missing either task, without touching the API', async () => {
    const fetchMock = stubFetch({})
    const server = new AstridMCPServerOAuth({ accessToken: 'astrid_mcp_test' })

    const result = await callTool(server, 'add_blocker', { taskId: 'AWTD-7' })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/blockingTaskId/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('MCP handoff_task (AWTD-1686)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('is advertised', () => {
    expect(OAUTH_MCP_TOOLS.map(t => t.name)).toContain('handoff_task')
  })

  it('POSTs the half to the source task\'s handoff route', async () => {
    const fetchMock = stubFetch({ taskId: 't7', half: { id: 'h1' }, returnAssigneeId: 'ai-agent-claude' })
    const server = new AstridMCPServerOAuth({ accessToken: 'astrid_mcp_test' })

    const result = await callTool(server, 'handoff_task', {
      taskId: 'AWTD-7',
      targetListId: 'ios-board',
      title: '[ios] the other half',
      description: 'contract',
      priority: 2,
    })

    expect(result.isError).toBeFalsy()
    expect(urlOf(fetchMock)).toMatch(/\/api\/v1\/tasks\/AWTD-7\/handoff$/)
    expect(initOf(fetchMock).method).toBe('POST')
    expect(JSON.parse(String(initOf(fetchMock).body))).toEqual({
      targetListId: 'ios-board',
      title: '[ios] the other half',
      description: 'contract',
      priority: 2,
    })
    expect(JSON.parse(result.content[0].text)).toMatchObject({ success: true, returnAssigneeId: 'ai-agent-claude' })
  })

  it('refuses a call with no target list, without touching the API', async () => {
    const fetchMock = stubFetch({})
    const server = new AstridMCPServerOAuth({ accessToken: 'astrid_mcp_test' })

    const result = await callTool(server, 'handoff_task', { taskId: 'AWTD-7', title: 'x' })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/targetListId/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
