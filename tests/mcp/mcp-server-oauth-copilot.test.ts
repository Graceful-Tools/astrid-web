import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AstridMCPServerOAuth from '@/mcp/mcp-server-oauth'
import { BRAND } from '@/lib/brand/config'

describe('Copilot MCP API forwarding (task d9e4aae0)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    // The default base is the brand origin only when no deployment origin is configured (ADEV-99).
    vi.stubEnv('ASTRID_API_BASE_URL', '')
    vi.stubEnv('NEXTAUTH_URL', '')
  })

  afterEach(() => vi.unstubAllEnvs())

  it('forwards a static MCP token as a bearer credential', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ comments: [] }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const server = new AstridMCPServerOAuth({ accessToken: 'astrid_mcp_copilot' })

    await (server as any).getTaskComments({ taskId: 'task-1' })

    expect(fetchMock).toHaveBeenCalledWith(
      `https://${BRAND.domain}/api/v1/tasks/task-1/comments`,
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
      `https://${BRAND.domain}/api/v1/tasks/task-1`,
      expect.objectContaining({ method: 'PUT' }),
    )
  })
})
