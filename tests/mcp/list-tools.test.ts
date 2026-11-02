/**
 * AWTD-1491 — an agent can set up a workspace over MCP.
 *
 * /starthere describes five lists whose descriptions are agent instructions.
 * The remote MCP surface could read lists but not create one or set its
 * description, so an agent following the guide could not do step 1.
 */
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import AstridMCPServerOAuth from '@/mcp/mcp-server-oauth'
import { OAUTH_MCP_TOOLS } from '@/mcp/tool-definitions'

function stubFetch(json: unknown, init: { ok?: boolean; status?: number } = {}) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: '',
    json: async () => json,
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function callTool(server: AstridMCPServerOAuth, name: string, args: unknown) {
  const handler = (server as any).server._requestHandlers.get('tools/call')
  return handler({ method: 'tools/call', params: { name, arguments: args } }, {})
}

const urlOf = (fetchMock: Mock, i = 0) => String(fetchMock.mock.calls[i][0])
const initOf = (fetchMock: Mock, i = 0) => fetchMock.mock.calls[i][1] as RequestInit
const bodyOf = (fetchMock: Mock, i = 0) => JSON.parse(String(initOf(fetchMock, i).body))

describe('MCP list tools (AWTD-1491)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('advertises create_list and update_list, and no invite or delete tool', () => {
    const names = OAUTH_MCP_TOOLS.map(t => t.name)
    expect(names).toContain('create_list')
    expect(names).toContain('update_list')
    expect(names.some(n => /invite|delete_list|add_list_member/.test(n))).toBe(false)
  })

  it('create_list POSTs a PRIVATE list with its instructions and default agent', async () => {
    const fetchMock = stubFetch({ list: { id: 'l1', name: 'Build' } })
    const server = new AstridMCPServerOAuth({ accessToken: 'astrid_mcp_test' })

    const result = await callTool(server, 'create_list', {
      name: 'Build',
      description: 'Build the feature. Open a PR.',
      defaultAssigneeId: 'ai-agent-claude',
    })

    expect(result.isError).toBeFalsy()
    expect(urlOf(fetchMock)).toMatch(/\/api\/v1\/lists$/)
    expect(initOf(fetchMock).method).toBe('POST')
    expect(bodyOf(fetchMock)).toEqual({
      name: 'Build',
      description: 'Build the feature. Open a PR.',
      defaultAssigneeId: 'ai-agent-claude',
      privacy: 'PRIVATE',
    })
    expect(JSON.parse(result.content[0].text)).toMatchObject({ success: true, list: { id: 'l1' } })
  })

  it('never lets an agent choose visibility — privacy is refused, not forwarded', async () => {
    const fetchMock = stubFetch({})
    const server = new AstridMCPServerOAuth({ accessToken: 'astrid_mcp_test' })

    const created = await callTool(server, 'create_list', { name: 'Leak', privacy: 'PUBLIC' })
    const updated = await callTool(server, 'update_list', { listId: 'l1', privacy: 'PUBLIC' })

    expect(created.isError).toBe(true)
    expect(created.content[0].text).toMatch(/does not accept: privacy/)
    expect(updated.isError).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('update_list PUTs only the fields passed, and can clear the default assignee', async () => {
    const fetchMock = stubFetch({ list: { id: 'l1' } })
    const server = new AstridMCPServerOAuth({ accessToken: 'astrid_mcp_test' })

    const result = await callTool(server, 'update_list', {
      listId: 'l1',
      description: 'New instructions',
      defaultAssigneeId: null,
    })

    expect(result.isError).toBeFalsy()
    expect(urlOf(fetchMock)).toMatch(/\/api\/v1\/lists\/l1$/)
    expect(initOf(fetchMock).method).toBe('PUT')
    expect(bodyOf(fetchMock)).toEqual({ description: 'New instructions', defaultAssigneeId: null })
  })

  it('refuses a call missing its required field or with nothing to change, without touching the API', async () => {
    const fetchMock = stubFetch({})
    const server = new AstridMCPServerOAuth({ accessToken: 'astrid_mcp_test' })

    expect((await callTool(server, 'create_list', { description: 'x' })).content[0].text).toMatch(/name is required/)
    expect((await callTool(server, 'update_list', { name: 'x' })).content[0].text).toMatch(/listId is required/)
    expect((await callTool(server, 'update_list', { listId: 'l1' })).content[0].text).toMatch(/at least one of/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('defaultAgent routes the list to an agent by mailbox, resolved to its real id', async () => {
    // Agent user ids are generated, not "ai-agent-<mailbox>", so the tool asks
    // the queue endpoint who "muse" is rather than guessing.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ agent: { mailbox: 'muse', id: 'cuid-muse-123' } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ list: { id: 'l1' } }) })
    vi.stubGlobal('fetch', fetchMock)
    const server = new AstridMCPServerOAuth({ accessToken: 'astrid_mcp_test' })

    const result = await callTool(server, 'create_list', { name: 'Plan', defaultAgent: 'Muse' })

    expect(result.isError).toBeFalsy()
    expect(urlOf(fetchMock, 0)).toMatch(/\/api\/v1\/agent-queue\?agent=muse$/)
    expect(bodyOf(fetchMock, 1)).toEqual({ name: 'Plan', defaultAssigneeId: 'cuid-muse-123', privacy: 'PRIVATE' })
  })

  it('refuses defaultAgent for an agent with no account yet, and both fields at once', async () => {
    const fetchMock = stubFetch({ agent: { mailbox: 'codex', id: null } })
    const server = new AstridMCPServerOAuth({ accessToken: 'astrid_mcp_test' })

    const noAccount = await callTool(server, 'create_list', { name: 'Fix', defaultAgent: 'codex' })
    expect(noAccount.isError).toBe(true)
    expect(noAccount.content[0].text).toMatch(/"codex" agent has no account/)
    expect(fetchMock).toHaveBeenCalledTimes(1) // the lookup, never the create

    const both = await callTool(server, 'update_list', { listId: 'l1', defaultAgent: 'claude', defaultAssigneeId: 'u1' })
    expect(both.content[0].text).toMatch(/not both/)
  })

  it('explains a 403: a token without lists:write, or not the list owner/admin', async () => {
    stubFetch({ error: 'Forbidden', message: 'Missing scope lists:write' }, { ok: false, status: 403 })
    const server = new AstridMCPServerOAuth({ accessToken: 'astrid_mcp_test' })

    const result = await callTool(server, 'create_list', { name: 'Build' })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/lists:write/)
    expect(result.content[0].text).toMatch(/owner or an admin/)
  })
})
