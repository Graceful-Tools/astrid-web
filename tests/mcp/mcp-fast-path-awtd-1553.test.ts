/**
 * AWTD-1553: hosted MCP fast path. Every new path is opt-in; the default output
 * is byte-identical to what it was.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import AstridMCPServerOAuth from '@/mcp/mcp-server-oauth'
import { OAuthAPIClient } from '@/mcp/oauth-api-client'
import { McpAgentIdentity } from '@/mcp/agent-identity'
import { pageComments, truncateWithMarker } from '@/mcp/compact-projection'

const LONG = 'x'.repeat(5000)

function stubFetch(json: unknown) {
  const fetchMock = vi.fn().mockImplementation(async () => ({ ok: true, json: async () => json }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
const newServer = () => new AstridMCPServerOAuth({ accessToken: 'astrid_mcp_test' })
const textOf = (r: any) => r.content[0].text as string

afterEach(() => vi.unstubAllGlobals())

describe('default output is unchanged (AWTD-1553)', () => {
  it('get_agent_queue stays pretty-printed with full descriptions', async () => {
    const data = { agent: { id: 'a' }, queue: [{ id: 't', description: LONG }] }
    stubFetch(data)
    const out = await (newServer() as any).getAgentQueue({ agent: 'claude' })
    expect(textOf(out)).toBe(JSON.stringify(data, null, 2))
  })

  it('get_task_comments returns the whole history without limit or before', async () => {
    const comments = [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }]
    stubFetch({ comments })
    const out = await (newServer() as any).getTaskComments({ taskId: 't' })
    expect(textOf(out)).toBe(JSON.stringify({ taskId: 't', comments }, null, 2))
  })
})

describe('compact projection (AWTD-1553)', () => {
  it('compact get_agent_queue truncates descriptions with a marker and prints one line', async () => {
    stubFetch({ agent: { id: 'a' }, queue: [{ id: 't', description: LONG }] })
    const out = textOf(await (newServer() as any).getAgentQueue({ agent: 'claude', compact: true }))
    expect(out).not.toContain('\n')
    const parsed = JSON.parse(out)
    expect(parsed.queue[0].description.length).toBeLessThan(900)
    expect(parsed.queue[0].description).toContain('[truncated')
  })

  it('compact get_task honours maxDescriptionChars and leaves short descriptions alone', async () => {
    stubFetch({ task: { id: 't', description: LONG } })
    const out = JSON.parse(
      textOf(await (newServer() as any).getTask({ taskId: 't', compact: true, maxDescriptionChars: 10 })),
    )
    expect(out.description.startsWith('xxxxxxxxxx…')).toBe(true)
    expect(truncateWithMarker('short', 600)).toBe('short')
  })

  it('get_task_comments caps history to the newest N and pages back with a cursor', async () => {
    const comments = ['c1', 'c2', 'c3', 'c4', 'c5'].map(id => ({ id }))
    stubFetch({ comments })
    const first = JSON.parse(textOf(await (newServer() as any).getTaskComments({ taskId: 't', limit: 2 })))
    expect(first.comments.map((c: any) => c.id)).toEqual(['c4', 'c5'])
    expect(first.nextCursor).toBe('c4')
    expect(first.totalCount).toBe(5)
    const older = pageComments(comments, { limit: 2, before: first.nextCursor })!
    expect(older.comments.map(c => c.id)).toEqual(['c2', 'c3'])
    const oldest = pageComments(comments, { limit: 5, before: 'c2' })!
    expect(oldest.comments.map(c => c.id)).toEqual(['c1'])
    expect(oldest.nextCursor).toBeUndefined()
  })
})

describe('cheap write identity (AWTD-1553)', () => {
  it('resolves an unknown mailbox with identityOnly, not a full queue read', async () => {
    const requests: string[] = []
    const client = {
      makeRequest: async (path: string) => {
        requests.push(path)
        return { agent: { mailbox: 'zed', id: 'ai-agent-zed' } }
      },
    }
    const sig = await new McpAgentIdentity(null).resolveSignatureFor('zed', client as any)
    expect(sig).toEqual({ aiAgentId: 'ai-agent-zed' })
    expect(requests[0]).toContain('identityOnly=true')
  })
})

describe('same-backend dispatch (AWTD-1553)', () => {
  const clientWith = (localDispatch: any) =>
    new OAuthAPIClient('https://example.test', undefined, undefined, 'tok', false, localDispatch)

  it('serves a read from the in-process dispatcher with no HTTP call', async () => {
    const fetchMock = stubFetch({ via: 'http' })
    const local = vi.fn().mockResolvedValue({ via: 'local' })
    expect(await clientWith(local).makeRequest('/api/v1/lists')).toEqual({ via: 'local' })
    expect(local).toHaveBeenCalledWith('/api/v1/lists', 'tok')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('falls back to HTTP when the dispatcher throws or declines', async () => {
    const fetchMock = stubFetch({ via: 'http' })
    expect(await clientWith(vi.fn().mockRejectedValue(new Error('boom'))).makeRequest('/x')).toEqual({ via: 'http' })
    expect(await clientWith(vi.fn().mockResolvedValue(null)).makeRequest('/x')).toEqual({ via: 'http' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('never dispatches a write in-process, so a fallback cannot repeat one', async () => {
    const fetchMock = stubFetch({ via: 'http' })
    const local = vi.fn().mockResolvedValue({ via: 'local' })
    await clientWith(local).makeRequest('/x', { method: 'POST', body: '{}' })
    expect(local).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
