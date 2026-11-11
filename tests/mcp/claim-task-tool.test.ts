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

  it('registers only when enabled and proxies the atomic claim action', async () => {
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

  it('keeps the existing tools/list unchanged while the API flag is off', async () => {
    vi.stubEnv('ASTRID_AGENT_CLAIM_API', '')
    const server = new AstridMCPServerOAuth({ accessToken: 'astrid_mcp_test' })
    const listTools = (server as any).server._requestHandlers.get('tools/list')
    const { tools } = await listTools({ method: 'tools/list', params: {} }, {})

    expect(tools).toBe(OAUTH_MCP_TOOLS)
    expect(JSON.stringify(tools)).not.toContain('"claim_task"')
    expect(tools.find((tool: { name: string }) => tool.name === 'get_agent_queue')?.description)
      .toContain('Prefer runnable.version 1')
    expect(createHash('sha256').update(JSON.stringify(tools)).digest('hex')).toBe(
      'a7897ef7507420d1882b660876647e4a70621a4bad746deb97e4d13244c32462',
    )
  })

  it('refuses a manual claim call while the API flag is off', async () => {
    vi.stubEnv('ASTRID_AGENT_CLAIM_API', '')
    const fetchMock = stubFetch({})
    const server = new AstridMCPServerOAuth({ accessToken: 'astrid_mcp_test' })

    const result = await callTool(server, 'claim_task', {
      taskId: 'task-1',
      action: 'claim',
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/unavailable/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
