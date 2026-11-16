// @vitest-environment node
/**
 * AWTD-1691: the narrowed SDK's typed REST client. Each method is one existing
 * server endpoint; these tests pin the request each one sends and how each
 * documented response is read.
 */
import { describe, expect, it, vi } from 'vitest'
import { AstridApiError, AstridClient } from './client.js'

type Reply = { status: number; body?: unknown }

function fakeFetch(...replies: Reply[]) {
  const queue = [...replies]
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const next = queue.shift()
    if (!next) throw new Error('unexpected request')
    return new Response(next.body === undefined ? null : JSON.stringify(next.body), {
      status: next.status,
      headers: { 'Content-Type': 'application/json' },
    })
  })
}

const TOKEN_REPLY: Reply = { status: 200, body: { access_token: 'oauth-token', expires_in: 3600 } }

function headersOf(call: unknown[]): Record<string, string> {
  return ((call[1] as RequestInit | undefined)?.headers ?? {}) as Record<string, string>
}

describe('AstridClient auth (AWTD-1691)', () => {
  it('sends an agent-bound token as a bearer, with no token exchange', async () => {
    const fetchImpl = fakeFetch({ status: 200, body: { empty: true, queue: [] } })
    const client = new AstridClient({ origin: 'https://astrid.test', auth: { token: 'astrid_mcp_x' }, fetch: fetchImpl })

    await client.getQueue({ agent: 'claude' })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(headersOf(fetchImpl.mock.calls[0])['Authorization']).toBe('Bearer astrid_mcp_x')
  })

  it('exchanges client credentials once and sends the result as X-OAuth-Token', async () => {
    const fetchImpl = fakeFetch(TOKEN_REPLY, { status: 200, body: { empty: true, queue: [] } }, { status: 200, body: { empty: true, queue: [] } })
    const client = new AstridClient({
      origin: 'https://astrid.test',
      auth: { clientId: 'id', clientSecret: 'secret' },
      fetch: fetchImpl,
    })

    await client.getQueue({ agent: 'claude' })
    await client.getQueue({ agent: 'claude' })

    expect(fetchImpl).toHaveBeenCalledTimes(3)
    const [tokenUrl, tokenInit] = fetchImpl.mock.calls[0]
    expect(tokenUrl).toBe('https://astrid.test/api/v1/oauth/token')
    expect(JSON.parse(String(tokenInit?.body))).toMatchObject({
      grant_type: 'client_credentials', client_id: 'id', client_secret: 'secret',
    })
    expect(headersOf(fetchImpl.mock.calls[1])['X-OAuth-Token']).toBe('oauth-token')
    expect(headersOf(fetchImpl.mock.calls[2])['X-OAuth-Token']).toBe('oauth-token')
  })

  it('throws AstridApiError with the status when the token exchange fails', async () => {
    const client = new AstridClient({
      origin: 'https://astrid.test',
      auth: { clientId: 'id', clientSecret: 'bad' },
      fetch: fakeFetch({ status: 401, body: { error: 'invalid_client' } }),
    })

    await expect(client.getQueue({ agent: 'claude' })).rejects.toMatchObject({ status: 401 })
  })
})

describe('AstridClient.getQueue (AWTD-1691)', () => {
  it('reads GET /api/v1/agent-queue with the agent, list and unassigned flag', async () => {
    const snapshot = { empty: false, queue: [{ id: 't1' }], attention: { tasks: [], messages: [] } }
    const fetchImpl = fakeFetch({ status: 200, body: snapshot })
    const client = new AstridClient({ origin: 'https://astrid.test', auth: { token: 't' }, fetch: fetchImpl })

    const result = await client.getQueue({ agent: 'claude', listId: 'list-1', includeUnassigned: true })

    expect(result).toEqual(snapshot)
    const url = new URL(String(fetchImpl.mock.calls[0][0]))
    expect(url.pathname).toBe('/api/v1/agent-queue')
    expect(url.searchParams.get('agent')).toBe('claude')
    expect(url.searchParams.get('listId')).toBe('list-1')
    expect(url.searchParams.get('includeUnassigned')).toBe('true')
  })

  it('carries the server reason on a refused read', async () => {
    const client = new AstridClient({
      origin: 'https://astrid.test',
      auth: { token: 't' },
      fetch: fakeFetch({ status: 400, body: { error: 'Unknown agent "x"' } }),
    })

    const error = await client.getQueue({ agent: 'x' }).catch(e => e)
    expect(error).toBeInstanceOf(AstridApiError)
    expect(error.status).toBe(400)
    expect(error.message).toContain('Unknown agent "x"')
  })
})

describe('AstridClient.claimTask (AWTD-1691)', () => {
  it('posts the action and mailbox local part to /tasks/:id/claim', async () => {
    const fetchImpl = fakeFetch({ status: 200, body: { outcome: 'claimed', task: { id: 'task-1', statusRole: 'doing' } } })
    const client = new AstridClient({ origin: 'https://astrid.test', auth: { token: 't' }, fetch: fetchImpl })

    const result = await client.claimTask('task-1', { action: 'claim', agentMailbox: 'scout.oc@astrid.cc' })

    expect(result).toMatchObject({ status: 200, outcome: 'claimed' })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://astrid.test/api/v1/tasks/task-1/claim')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ action: 'claim', agentMailbox: 'scout.oc' })
  })

  it.each([
    [409, 'conflict'],
    [409, 'not_ready'],
    [404, 'not_found'],
    [403, 'forbidden'],
  ])('returns a %i %s outcome instead of throwing', async (status, outcome) => {
    const client = new AstridClient({
      origin: 'https://astrid.test',
      auth: { token: 't' },
      fetch: fakeFetch({ status, body: { outcome, task: null } }),
    })

    await expect(client.claimTask('task-1', { action: 'claim' })).resolves.toMatchObject({ status, outcome })
  })

  it('reports the claim API as unavailable when the route is off (404 with no outcome)', async () => {
    const client = new AstridClient({
      origin: 'https://astrid.test',
      auth: { token: 't' },
      fetch: fakeFetch({ status: 404, body: { error: 'Not found' } }),
    })

    await expect(client.claimTask('task-1', { action: 'claim' })).resolves.toMatchObject({ status: 404, outcome: 'unavailable' })
  })

  it('releaseTask is the release action of the same route', async () => {
    const fetchImpl = fakeFetch({ status: 200, body: { outcome: 'released', task: { id: 'task-1', statusRole: 'ready' } } })
    const client = new AstridClient({ origin: 'https://astrid.test', auth: { token: 't' }, fetch: fetchImpl })

    await expect(client.releaseTask('task-1', 'claude')).resolves.toMatchObject({ outcome: 'released' })
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toEqual({ action: 'release', agentMailbox: 'claude' })
  })
})

describe('AstridClient.claimFixallTask (AWTD-1691)', () => {
  it('posts to /claim-fixall with a null watermark for a ready claim', async () => {
    const fetchImpl = fakeFetch({ status: 200, body: { claimed: true, taskId: 'task-1', assigneeEmail: 'claude@astrid.test' } })
    const client = new AstridClient({ origin: 'https://astrid.test', auth: { token: 't' }, fetch: fetchImpl })

    const result = await client.claimFixallTask('task-1', { action: 'ready', agent: 'claude', listId: 'list-1' })

    expect(result).toMatchObject({ status: 200, claimed: true })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://astrid.test/api/v1/tasks/task-1/claim-fixall')
    expect(JSON.parse(String(init?.body))).toEqual({ action: 'ready', commentWatermark: null, agent: 'claude', listId: 'list-1' })
  })

  it('returns a 409 as not claimed, with the server reason', async () => {
    const client = new AstridClient({
      origin: 'https://astrid.test',
      auth: { token: 't' },
      fetch: fakeFetch({ status: 409, body: { error: 'Task changed after queue selection and was not claimed' } }),
    })

    await expect(client.claimFixallTask('task-1', { action: 'ready' })).resolves.toMatchObject({
      status: 409, claimed: false, error: 'Task changed after queue selection and was not claimed',
    })
  })
})

describe('AstridClient task writes (AWTD-1691)', () => {
  it('addComment posts the content, signed by the agent when given', async () => {
    const fetchImpl = fakeFetch({ status: 200, body: { comment: { id: 'c1', content: 'hi' } } })
    const client = new AstridClient({ origin: 'https://astrid.test', auth: { token: 't' }, fetch: fetchImpl })

    await expect(client.addComment('task-1', 'hi', { aiAgentId: 'ai-agent-claude' })).resolves.toMatchObject({ id: 'c1' })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://astrid.test/api/v1/tasks/task-1/comments')
    expect(JSON.parse(String(init?.body))).toEqual({ content: 'hi', aiAgentId: 'ai-agent-claude' })
  })

  it('handBack writes the Inbox, assigned to the person, in one PUT', async () => {
    const fetchImpl = fakeFetch({ status: 200, body: { task: { id: 'task-1', statusRole: null } } })
    const client = new AstridClient({ origin: 'https://astrid.test', auth: { token: 't' }, fetch: fetchImpl })

    await client.handBack('task-1', 'person-1')
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://astrid.test/api/v1/tasks/task-1')
    expect(init?.method).toBe('PUT')
    expect(JSON.parse(String(init?.body))).toEqual({ statusRole: null, assigneeId: 'person-1' })
  })

  it('setStatus moves the board column', async () => {
    const fetchImpl = fakeFetch({ status: 200, body: { task: { id: 'task-1', statusRole: 'ready' } } })
    const client = new AstridClient({ origin: 'https://astrid.test', auth: { token: 't' }, fetch: fetchImpl })

    await expect(client.setStatus('task-1', 'ready')).resolves.toMatchObject({ statusRole: 'ready' })
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toEqual({ statusRole: 'ready' })
  })

  it('getTask and getComments unwrap their envelopes', async () => {
    const client = new AstridClient({
      origin: 'https://astrid.test',
      auth: { token: 't' },
      fetch: fakeFetch(
        { status: 200, body: { task: { id: 'task-1', title: 'T' } } },
        { status: 200, body: { comments: [{ id: 'c1', content: 'x' }] } },
      ),
    })

    await expect(client.getTask('task-1')).resolves.toMatchObject({ title: 'T' })
    await expect(client.getComments('task-1')).resolves.toHaveLength(1)
  })
})
