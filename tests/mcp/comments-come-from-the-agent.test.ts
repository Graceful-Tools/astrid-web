/**
 * AWTD-878: a comment written by the coding agent must be signed by the coding agent.
 *
 * `POST /api/v1/tasks/:id/comments` has always accepted an `aiAgentId` and
 * validated it names a real AI-agent user before using it as the author. The
 * repo's own scripts pass it — post-session-link.ts and add-task-comment.ts both
 * send CLAUDE_AGENT_ID — but the MCP server posted `{ content, type }` and
 * nothing else, so the route fell back to the OAuth client's owner. Every
 * strategy comment and completion report the /fixall loop has ever written was
 * signed with the account holder's name and face.
 *
 * The identity is not configuration the harness has to remember: it DECLARES it
 * on every poll. `get_agent_queue { agent: "claude" }` answers
 * `agent: { mailbox, email, id, name }`, and that id is the author.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import AstridMCPServerOAuth from '@/mcp/mcp-server-oauth'
import { agentEmail } from '@/lib/brand/agent-emails'

const AGENT_ID = 'ai-agent-claude'

function jsonOk(payload: unknown) {
  return { ok: true, json: async () => payload }
}

/** The shape /api/v1/agent-queue answers, trimmed to what this server reads. */
function queueResponse() {
  return {
    agent: { mailbox: 'claude', email: agentEmail('claude'), id: AGENT_ID, name: 'Claude Agent' },
    empty: true,
    queue: [],
  }
}

function commentBodyFrom(fetchMock: ReturnType<typeof vi.fn>) {
  const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/comments'))
  if (!call) throw new Error('no comment POST was made')
  return JSON.parse((call[1] as RequestInit).body as string)
}

describe('MCP comments are attributed to the agent (AWTD-878)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    delete process.env.ASTRID_AGENT_ID
  })

  afterEach(() => {
    delete process.env.ASTRID_AGENT_ID
  })

  it('signs a comment with the identity the harness declared to get_agent_queue', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      String(url).includes('/agent-queue')
        ? jsonOk(queueResponse())
        : jsonOk({ comment: { id: 'c1' } }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const server = new AstridMCPServerOAuth({ accessToken: 'astrid_mcp_token' })

    await (server as any).getAgentQueue({ agent: 'claude' })
    await (server as any).addComment({ taskId: 'task-1', content: 'progress' })

    expect(commentBodyFrom(fetchMock).aiAgentId).toBe(AGENT_ID)
  })

  it('reads ASTRID_AGENT_ID when it comments before it ever polls', async () => {
    process.env.ASTRID_AGENT_ID = AGENT_ID
    const fetchMock = vi.fn(async () => jsonOk({ comment: { id: 'c1' } }))
    vi.stubGlobal('fetch', fetchMock)
    const server = new AstridMCPServerOAuth({ accessToken: 'astrid_mcp_token' })

    await (server as any).addComment({ taskId: 'task-1', content: 'progress' })

    expect(commentBodyFrom(fetchMock).aiAgentId).toBe(AGENT_ID)
  })

  it('the declared identity wins over the configured one, so a mailbox typo in config cannot mis-sign', async () => {
    process.env.ASTRID_AGENT_ID = 'ai-agent-stale'
    const fetchMock = vi.fn(async (url: string) =>
      String(url).includes('/agent-queue')
        ? jsonOk(queueResponse())
        : jsonOk({ comment: { id: 'c1' } }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const server = new AstridMCPServerOAuth({ accessToken: 'astrid_mcp_token' })

    await (server as any).getAgentQueue({ agent: 'claude' })
    await (server as any).addComment({ taskId: 'task-1', content: 'progress' })

    expect(commentBodyFrom(fetchMock).aiAgentId).toBe(AGENT_ID)
  })

  it('leaves a person driving this server from a desktop client signing as themselves', async () => {
    const fetchMock = vi.fn(async () => jsonOk({ comment: { id: 'c1' } }))
    vi.stubGlobal('fetch', fetchMock)
    const server = new AstridMCPServerOAuth({ accessToken: 'astrid_mcp_token' })

    await (server as any).addComment({ taskId: 'task-1', content: 'progress' })

    expect(commentBodyFrom(fetchMock)).not.toHaveProperty('aiAgentId')
  })

  it('does not claim an identity for an agent row that does not exist yet', async () => {
    // buildAgentQueue answers `id: null` for an identity nobody has assigned work
    // to. Forwarding that null would 400 the comment ("Invalid aiAgentId"), which
    // is a worse failure than the wrong name.
    const fetchMock = vi.fn(async (url: string) =>
      String(url).includes('/agent-queue')
        ? jsonOk({ ...queueResponse(), agent: { mailbox: 'gemini', email: agentEmail('gemini'), id: null } })
        : jsonOk({ comment: { id: 'c1' } }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const server = new AstridMCPServerOAuth({ accessToken: 'astrid_mcp_token' })

    await (server as any).getAgentQueue({ agent: 'gemini' })
    await (server as any).addComment({ taskId: 'task-1', content: 'progress' })

    expect(commentBodyFrom(fetchMock)).not.toHaveProperty('aiAgentId')
  })
})
