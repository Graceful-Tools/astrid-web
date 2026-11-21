import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { createHash } from 'node:crypto'
import AstridMCPServerOAuth from '@/mcp/mcp-server-oauth'
import { getOAuthMcpTools, OAUTH_MCP_TOOLS } from '@/mcp/tool-definitions'

function stubFetch(json: unknown, status = 200) {
  const statusText = new Map([
    [400, 'Bad Request'],
    [401, 'Unauthorized'],
    [403, 'Forbidden'],
    [404, 'Not Found'],
    [405, 'Method Not Allowed'],
    [409, 'Conflict'],
    [500, 'Internal Server Error'],
    [501, 'Not Implemented'],
  ]).get(status) || ''
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => json,
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function callTool(server: AstridMCPServerOAuth, name: string, args: unknown) {
  const handler = (server as any).server._requestHandlers.get('tools/call')
  return handler({ method: 'tools/call', params: { name, arguments: args } }, {})
}

const urlOf = (fetchMock: Mock) => String(fetchMock.mock.calls[0][0])
const bodyOf = (fetchMock: Mock) => JSON.parse(String(fetchMock.mock.calls[0][1].body))

describe('MCP claim_task tool (AWTD-1557)', () => {
  afterEach(() => vi.unstubAllEnvs())

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('registers and proxies the atomic claim action', async () => {
    vi.stubEnv('ASTRID_AGENT_CLAIM_API', 'on')
    const apiResult = { outcome: 'claimed', task: { id: 'task-1', statusRole: 'doing' } }
    const fetchMock = stubFetch(apiResult)
    const server = new AstridMCPServerOAuth({ accessToken: 'astrid_mcp_test' })

    const result = await callTool(server, 'claim_task', {
      taskId: 'task-1',
      action: 'claim',
      agent: 'copilot',
    })
    const listTools = (server as any).server._requestHandlers.get('tools/list')
    const { tools } = await listTools({ method: 'tools/list', params: {} }, {})

    expect(getOAuthMcpTools()).toEqual(tools)
    expect(JSON.stringify(tools)).toContain('"claim_task"')
    expect(result.isError).toBeFalsy()
    expect(urlOf(fetchMock)).toMatch(/\/api\/v1\/tasks\/task-1\/claim$/)
    expect(fetchMock.mock.calls[0][1].method).toBe('POST')
    expect(bodyOf(fetchMock)).toEqual({
      action: 'claim',
      agentMailbox: 'copilot',
    })
    expect(JSON.parse(result.content[0].text)).toEqual(apiResult)
  })

  it.each([
    ['conflict', 409],
    ['not_ready', 409],
    ['forbidden', 403],
    ['not_found', 404],
  ] as const)('returns %s outcomes as normal tool results (AWTD-1557)', async (outcome, status) => {
    vi.stubEnv('ASTRID_AGENT_CLAIM_API', 'on')
    const apiResult = { outcome, task: null }
    stubFetch(apiResult, status)
    const server = new AstridMCPServerOAuth({ accessToken: 'astrid_mcp_test' })

    const result = await callTool(server, 'claim_task', { taskId: 'task-1', action: 'claim' })

    expect(result.isError).toBeFalsy()
    expect(JSON.parse(result.content[0].text)).toEqual(apiResult)
  })

  it('keeps server failures as tool errors (AWTD-1557)', async () => {
    vi.stubEnv('ASTRID_AGENT_CLAIM_API', 'on')
    stubFetch({ error: 'Internal Server Error' }, 500)
    const server = new AstridMCPServerOAuth({ accessToken: 'astrid_mcp_test' })

    const result = await callTool(server, 'claim_task', { taskId: 'task-1', action: 'claim' })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/Internal Server Error/)
  })

  it.each([
    [400, 'Bad Request'],
    [401, 'Unauthorized'],
  ])('keeps HTTP %i failures without an outcome as tool errors (AWTD-1557)', async (status, error) => {
    vi.stubEnv('ASTRID_AGENT_CLAIM_API', 'on')
    stubFetch({ error }, status)
    const server = new AstridMCPServerOAuth({ accessToken: 'astrid_mcp_test' })

    const result = await callTool(server, 'claim_task', { taskId: 'task-1', action: 'claim' })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain(error)
  })

  it('lists claim_task with no env flag, and leaves every other tool as it was (AWTD-1688)', async () => {
    vi.stubEnv('ASTRID_AGENT_CLAIM_API', '')
    const server = new AstridMCPServerOAuth({ accessToken: 'astrid_mcp_test' })
    const listTools = (server as any).server._requestHandlers.get('tools/list')
    const { tools } = await listTools({ method: 'tools/list', params: {} }, {})

    const claimTool = tools.find((tool: { name: string }) => tool.name === 'claim_task')
    expect(claimTool?.inputSchema.properties.action.enum).toEqual(['claim', 'resume', 'release', 'heartbeat'])
    expect(tools.filter((tool: { name: string }) => tool.name !== 'claim_task')).toEqual([...OAUTH_MCP_TOOLS])
    // get_agent_queue now explains runnable: held at the 2026-11-10 review, released by
    // Jon's option 1 on 2026-11-13 (AWTD-1560). Replies want an answer; incomplete is
    // reported, never work on its own.
    const queueDescription = tools.find((tool: { name: string }) => tool.name === 'get_agent_queue')?.description
    expect(queueDescription).toContain('"attention"')
    expect(queueDescription).toContain('not work by itself')
    // Re-pinned for the Waiting rules (Jon, 2026-11-12): create_task / update_task gained
    // keepAssignee and waitOnTaskId and their statusRole descriptions name the wait condition;
    // add_blocker / remove_blocker say the server wakes the task, not a sweep.
    // Re-pinned for AWTD-1560 (2026-11-14): get_agent_queue explains runnable.
    // AWTD-1688 adds claim_task alongside and changes none of these.
    // Re-pinned for AWTD-1686 (2026-11-16): handoff_task added beside the blocker tools.
    // Re-pinned for AWTD-1693 (2026-11-16): get_orchestration_policy appended; no existing tool changed.
    // Re-pinned for ADEV-178 (2026-11-21): add_comment's Decision hint teaches the traffic-light method.
    expect(createHash('sha256').update(JSON.stringify(OAUTH_MCP_TOOLS)).digest('hex')).toBe(
      '4df90c19754808104cde6758dd6b0c513b5db31aa496edbf1d0356a300c29ea6',
    )
  })

  it('proxies a heartbeat with no env flag (AWTD-1688)', async () => {
    vi.stubEnv('ASTRID_AGENT_CLAIM_API', '')
    const apiResult = { outcome: 'renewed', task: { id: 'task-1', statusRole: 'doing' } }
    const fetchMock = stubFetch(apiResult)
    const server = new AstridMCPServerOAuth({ accessToken: 'astrid_mcp_test' })

    const result = await callTool(server, 'claim_task', { taskId: 'task-1', action: 'heartbeat', agent: 'claude' })

    expect(result.isError).toBeFalsy()
    expect(bodyOf(fetchMock)).toEqual({ action: 'heartbeat', agentMailbox: 'claude' })
    expect(JSON.parse(result.content[0].text)).toEqual(apiResult)
  })
})
