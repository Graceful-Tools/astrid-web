import { afterEach, describe, expect, it, vi } from 'vitest'
import { AstridOAuthClient } from './astrid-oauth.js'

describe('AstridOAuthClient claimTask (AWTD-1557)', () => {
  afterEach(() => vi.unstubAllGlobals())

  async function clientWithClaimResponse(status: number, body: unknown) {
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
        ok: status >= 200 && status < 300,
        status,
        statusText,
        json: async () => body,
      })
    vi.stubGlobal('fetch', fetchMock)
    return {
      client: new AstridOAuthClient({
        baseUrl: 'https://astrid.test',
        clientId: 'client-id',
        clientSecret: 'client-secret',
      }),
      fetchMock,
    }
  }

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

  it.each([
    ['conflict', 409],
    ['not_ready', 409],
    ['forbidden', 403],
    ['not_found', 404],
  ] as const)('returns %s outcomes as normal results (AWTD-1557)', async (outcome, status) => {
    const body = { outcome, task: null }
    const { client } = await clientWithClaimResponse(status, body)

    await expect(client.claimTask('task-1', { action: 'claim' })).resolves.toEqual({
      success: true,
      data: body,
    })
  })

  it('reports the claim API unavailable only for a body without an outcome (AWTD-1557)', async () => {
    const { client } = await clientWithClaimResponse(404, { error: 'Not Found' })

    await expect(client.claimTask('task-1', { action: 'claim' })).resolves.toMatchObject({
      success: false,
      unavailable: true,
      error: 'Atomic agent task claims are unavailable (HTTP 404).',
    })
  })

  it.each([404, 405, 501])('reports the claim API unavailable for HTTP %i without an outcome (AWTD-1557)', async status => {
    const { client } = await clientWithClaimResponse(status, {})

    await expect(client.claimTask('task-1', { action: 'claim' })).resolves.toMatchObject({
      success: false,
      unavailable: true,
      error: `Atomic agent task claims are unavailable (HTTP ${status}).`,
    })
  })

  it('keeps server failures as ordinary errors (AWTD-1557)', async () => {
    const { client } = await clientWithClaimResponse(500, { error: 'Internal Server Error' })

    const result = await client.claimTask('task-1', { action: 'claim' })
    expect(result.success).toBe(false)
    expect(result).not.toHaveProperty('unavailable')
    expect(result.error).toContain('Internal Server Error')
  })

  it('does not call an unknown 404 outcome unavailable (AWTD-1557)', async () => {
    const { client } = await clientWithClaimResponse(404, { outcome: 'unexpected', error: 'Unexpected response' })

    const result = await client.claimTask('task-1', { action: 'claim' })
    expect(result.success).toBe(false)
    expect(result).not.toHaveProperty('unavailable')
    expect(result.error).toContain('Unexpected response')
  })
})
