import { beforeEach, describe, expect, it, vi } from 'vitest'
import AstridMCPServerOAuth from '@/mcp/mcp-server-oauth'

describe('Copilot MCP API forwarding (task d9e4aae0)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('forwards a static MCP token as a bearer credential', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ comments: [] }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const server = new AstridMCPServerOAuth({ accessToken: 'astrid_mcp_copilot' })

    await (server as any).getTaskComments({ taskId: 'task-1' })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://astrid.cc/api/v1/tasks/task-1/comments',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer astrid_mcp_copilot',
        }),
      }),
    )
  })

  it('uses the v1 task endpoint supported update method', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ task: { id: 'task-1', completed: true } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const server = new AstridMCPServerOAuth({ accessToken: 'astrid_mcp_copilot' })

    await (server as any).updateTask({ taskId: 'task-1', completed: true })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://astrid.cc/api/v1/tasks/task-1',
      expect.objectContaining({ method: 'PUT' }),
    )
  })
})
