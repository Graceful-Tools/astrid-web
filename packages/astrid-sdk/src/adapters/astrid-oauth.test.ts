import { afterEach, describe, expect, it, vi } from 'vitest'
import { AstridOAuthClient } from './astrid-oauth.js'

describe('AstridOAuthClient claimTask (AWTD-1557)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends the atomic claim request', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'oauth-token',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'tasks:write',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          outcome: 'claimed',
          task: { id: 'task-1', statusRole: 'doing' },
        }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const client = new AstridOAuthClient({
      baseUrl: 'https://astrid.test',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    })
    const result = await client.claimTask('task-1', {
      action: 'claim',
      agentMailbox: 'copilot',
    })

    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://astrid.test/api/v1/tasks/task-1/claim', {
      method: 'POST',
      headers: {
        'X-OAuth-Token': 'oauth-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'claim',
        agentMailbox: 'copilot',
      }),
    })
    expect(result).toEqual({
      success: true,
      data: {
        outcome: 'claimed',
        task: { id: 'task-1', statusRole: 'doing' },
      },
    })
  })

  it.each([404, 405, 501])('reports the claim API unavailable for HTTP %i', async status => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'oauth-token',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'tasks:write',
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status,
        statusText: '',
        json: async () => ({}),
      })
    vi.stubGlobal('fetch', fetchMock)

    const client = new AstridOAuthClient({
      baseUrl: 'https://astrid.test',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    })
    await expect(client.claimTask('task-1', { action: 'claim' })).resolves.toMatchObject({
      success: false,
      unavailable: true,
      error: `Atomic agent task claims are unavailable (HTTP ${status}).`,
    })
  })
})
