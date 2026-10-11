/**
 * MCP could create tasks and comments but had no way to put a screenshot on a
 * task: no tool took bytes, and add_comment had no fileId. An agent that had
 * captured the evidence could only paste a path on its own machine into the
 * description — which nobody reading the task can open.
 *
 * The bytes must NOT travel through a tool argument: a 2400×1310 PNG is
 * ~650 KB of base64, which is context, not data. So the tool mints a
 * short-lived upload ticket and the client PUTs the file itself.
 */

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import AstridMCPServerOAuth, { OAUTH_MCP_TOOLS } from '@/mcp/mcp-server-oauth'

const TOOL = 'create_task_attachment_upload'

function jsonOk(payload: unknown) {
  return { ok: true, json: async () => payload }
}

function call(fetchMock: Mock, suffix: string) {
  const found = fetchMock.mock.calls.find(([url]) => String(url).includes(suffix))
  if (!found) throw new Error(`no request to ${suffix}`)
  return { url: String(found[0]), init: found[1] as RequestInit }
}

const ticketResponse = {
  upload: {
    method: 'PUT',
    url: 'https://astrid.test/api/v1/attachment-uploads',
    headers: { 'X-Upload-Ticket': 't.sig', 'Content-Type': 'image/png' },
    expiresAt: '2026-10-10T22:00:00.000Z',
    maxBytes: 4 * 1024 * 1024,
  },
  taskId: 'task-1',
  fileName: 'shot.png',
  mimeType: 'image/png',
}

describe(`MCP ${TOOL}`, () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    delete process.env.ASTRID_AGENT_ID
  })

  it('is advertised with a schema that takes no file bytes', () => {
    const tool = OAUTH_MCP_TOOLS.find(t => t.name === TOOL) as any
    expect(tool).toBeDefined()
    expect(tool.inputSchema.required).toEqual(['taskId', 'fileName'])
    expect(Object.keys(tool.inputSchema.properties).sort()).toEqual(
      ['caption', 'clientRequestId', 'fileName', 'mimeType', 'taskId'].sort(),
    )
    expect(JSON.stringify(tool.inputSchema)).not.toMatch(/base64/i)
  })

  it('asks the v1 API for an upload ticket and returns a ready-to-run curl', async () => {
    const fetchMock = vi.fn(async () => jsonOk(ticketResponse))
    vi.stubGlobal('fetch', fetchMock)
    const server = new AstridMCPServerOAuth({ accessToken: 'astrid_token', baseUrl: 'https://astrid.test' })

    const result = await (server as any).server._requestHandlers.get('tools/call')(
      { method: 'tools/call', params: { name: TOOL, arguments: { taskId: 'AWTD-1172', fileName: 'shot.png', caption: 'Option A vs B' } } },
      {},
    )

    expect(result.isError).toBeUndefined()
    const { url, init } = call(fetchMock, '/attachment-uploads')
    expect(url).toBe('https://astrid.test/api/v1/tasks/AWTD-1172/attachment-uploads')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ fileName: 'shot.png', caption: 'Option A vs B' })

    const body = JSON.parse(result.content[0].text)
    expect(body.upload.url).toBe(ticketResponse.upload.url)
    expect(body.curl).toContain("--data-binary @'<path-to-shot.png>'")
    expect(body.curl).toContain("-H 'X-Upload-Ticket: t.sig'")
  })

  it('signs the attachment comment as the agent the harness declared', async () => {
    process.env.ASTRID_AGENT_ID = 'ai-agent-copilot'
    const fetchMock = vi.fn(async () => jsonOk(ticketResponse))
    vi.stubGlobal('fetch', fetchMock)
    const server = new AstridMCPServerOAuth({ accessToken: 'astrid_token', baseUrl: 'https://astrid.test' })

    await (server as any).server._requestHandlers.get('tools/call')(
      { method: 'tools/call', params: { name: TOOL, arguments: { taskId: 'task-1', fileName: 'shot.png' } } },
      {},
    )

    expect(JSON.parse(call(fetchMock, '/attachment-uploads').init.body as string).aiAgentId).toBe('ai-agent-copilot')
  })

  it('refuses a call without a taskId or fileName before touching the network', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const server = new AstridMCPServerOAuth({ accessToken: 'astrid_token', baseUrl: 'https://astrid.test' })

    const result = await (server as any).server._requestHandlers.get('tools/call')(
      { method: 'tools/call', params: { name: TOOL, arguments: { taskId: 'task-1' } } },
      {},
    )

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/fileName is required/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
