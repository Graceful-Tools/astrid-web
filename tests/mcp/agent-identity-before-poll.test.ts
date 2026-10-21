/**
 * RED for AWTD-1311: an agent write made before any poll was signed as Jon.
 *
 * Jon, on AWTD-1305: *"This comment is coming from the current user. This is a
 * bug. It should come from Claude."* Two agent comments on that task are stored
 * with `authorId` = the OAuth client owner and `clientRequestId: null` — so they
 * came through `POST /api/v1/tasks/:id/comments` with no `aiAgentId` at all,
 * not from the iOS or web client.
 *
 * AWTD-878 made the MCP server learn its identity from `get_agent_queue`, and
 * that works. The hole is the ORDER: `McpAgentIdentity` has nothing to go on
 * until the first poll, `ASTRID_AGENT_ID` is the only fallback, and `.env.local`
 * does not set it. A harness that comments before it polls therefore signs as
 * the client owner, silently.
 *
 * Config cannot close this. There is no `.mcp.json` in this repo —
 * `mcp/astrid-mcp-launch.js` exists precisely so credentials never get copied
 * into a per-client config — and `.env.local` is shared by every harness on the
 * machine, which is the cross-signing hazard `scripts/lib/agent-author.ts` is
 * already written against. So the declaration has to travel in the CALL:
 * `agent: "<mailbox>"` on the write itself.
 *
 * WHAT IS DELIBERATELY NOT CHANGED. A write that declares nothing still signs
 * as the caller — `comments-come-from-the-agent.test.ts` asserts that for a
 * person driving this server from a desktop client, and their comments should
 * carry their own name. The rule added here is narrower and absolute: once a
 * write DECLARES an agent, it is signed by that agent or it is refused. It never
 * quietly becomes a human write, because that is the failure above and it is
 * invisible in the response.
 */

import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import AstridMCPServerOAuth, { OAUTH_MCP_TOOLS } from '@/mcp/mcp-server-oauth'
import { agentEmail } from '@/lib/brand/agent-emails'

const CLAUDE = 'ai-agent-claude'
/** The OAuth client owner — the byline this bug produced. */
const OWNER = 'cmeje966q0000k1045si7zrz3'

function jsonOk(payload: unknown) {
  return { ok: true, json: async () => payload }
}

function bodyOf(fetchMock: Mock, suffix: string) {
  const call = fetchMock.mock.calls.find(([url]) => String(url).includes(suffix))
  if (!call) throw new Error(`no write to ${suffix} was made`)
  return JSON.parse((call[1] as RequestInit).body as string)
}

describe('an MCP write that declares an agent is signed by that agent (AWTD-1311)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    delete process.env.ASTRID_AGENT_ID
    delete process.env.ASTRID_AGENT_ID_CLAUDE
    delete process.env.ASTRID_AGENT_ID_COPILOT
    delete process.env.CLAUDE_AGENT_ID
  })

  afterEach(() => {
    delete process.env.ASTRID_AGENT_ID
    delete process.env.ASTRID_AGENT_ID_CLAUDE
    delete process.env.ASTRID_AGENT_ID_COPILOT
    delete process.env.CLAUDE_AGENT_ID
  })

  it('AWTD-1311: a comment posted before any poll is not attributed to the client owner', async () => {
    // The bug, as a test. No poll has happened, nothing is configured, and the
    // harness says who it is on the call itself.
    process.env.ASTRID_AGENT_ID_CLAUDE = CLAUDE
    const fetchMock = vi.fn(async () => jsonOk({ comment: { id: 'c1' } }))
    vi.stubGlobal('fetch', fetchMock)
    const server = new AstridMCPServerOAuth({ accessToken: 'astrid_mcp_token' })

    await (server as any).addComment({ taskId: 'task-1', content: 'strategy', agent: 'claude' })

    const body = bodyOf(fetchMock, '/comments')
    expect(body.aiAgentId).toBe(CLAUDE)
    expect(body.aiAgentId).not.toBe(OWNER)
  })

  it('AWTD-1311: REFUSES a declared write it cannot resolve, rather than signing as the caller', async () => {
    // The whole point. Falling through to the caller here would reproduce the
    // bug under a new name, and the response would look like a success. The
    // error names the env var to set, so the refusal is actionable rather than
    // just loud.
    const fetchMock = vi.fn(async () => jsonOk({ comment: { id: 'c1' } }))
    vi.stubGlobal('fetch', fetchMock)
    const server = new AstridMCPServerOAuth({ accessToken: 'astrid_mcp_token' })

    await expect(
      (server as any).addComment({ taskId: 'task-1', content: 'strategy', agent: 'claude' }),
    ).rejects.toThrow(/ASTRID_AGENT_ID_CLAUDE/)

    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/comments'))).toBe(false)
  })

  it('AWTD-1311: resolves a mailbox nobody has configured by name, not by guessing', async () => {
    // A harness this machine has never run still writes as itself as soon as
    // its one env var is set. The MCP path is env-only on purpose: this module
    // has to stay importless for the standalone stdio build, so it cannot reach
    // the network lookup lib/agent-author.ts gives the scripts.
    process.env.ASTRID_AGENT_ID_COPILOT = 'ai-agent-copilot'
    const fetchMock = vi.fn(async () => jsonOk({ comment: { id: 'c1' } }))
    vi.stubGlobal('fetch', fetchMock)
    const server = new AstridMCPServerOAuth({ accessToken: 'astrid_mcp_token' })

    await (server as any).addComment({ taskId: 'task-1', content: 'progress', agent: 'copilot' })

    expect(bodyOf(fetchMock, '/comments').aiAgentId).toBe('ai-agent-copilot')
  })

  it('AWTD-1311: never signs one harness as another — CLAUDE_AGENT_ID is claude-only', async () => {
    // `.env.local` on every machine that runs the Claude loop sets CLAUDE_AGENT_ID.
    // A Copilot write must not pick it up, which is the same rule AWTD-970 wrote
    // for the scripts. Unconfigured, it refuses — it does NOT fall through to
    // the claude id, and it does not fall through to Jon.
    process.env.CLAUDE_AGENT_ID = CLAUDE
    const fetchMock = vi.fn(async () => jsonOk({ comment: { id: 'c1' } }))
    vi.stubGlobal('fetch', fetchMock)
    const server = new AstridMCPServerOAuth({ accessToken: 'astrid_mcp_token' })

    await expect(
      (server as any).addComment({ taskId: 'task-1', content: 'progress', agent: 'copilot' }),
    ).rejects.toThrow(/ASTRID_AGENT_ID_COPILOT/)

    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/comments'))).toBe(false)
  })

  it('AWTD-1311: `agent: "me"` is how a person signs deliberately, not by omission', async () => {
    process.env.ASTRID_AGENT_ID_CLAUDE = CLAUDE
    const fetchMock = vi.fn(async () => jsonOk({ comment: { id: 'c1' } }))
    vi.stubGlobal('fetch', fetchMock)
    const server = new AstridMCPServerOAuth({ accessToken: 'astrid_mcp_token' })

    await (server as any).addComment({ taskId: 'task-1', content: 'mine', agent: 'me' })

    expect(bodyOf(fetchMock, '/comments')).not.toHaveProperty('aiAgentId')
  })

  it('AWTD-1311: a declared task update is signed too — the activity line names an actor', async () => {
    // `set-task-status.ts` already learned this (AWTD-974): a status change emits
    // "<name> moved this to Waiting", so an unsigned PUT puts Jon's name on a
    // move the loop made.
    process.env.ASTRID_AGENT_ID_CLAUDE = CLAUDE
    const fetchMock = vi.fn(async () => jsonOk({ task: { id: 'task-1' } }))
    vi.stubGlobal('fetch', fetchMock)
    const server = new AstridMCPServerOAuth({ accessToken: 'astrid_mcp_token' })

    await (server as any).updateTask({ taskId: 'task-1', statusRole: 'waiting', agent: 'claude' })

    expect(bodyOf(fetchMock, '/api/v1/tasks/task-1').aiAgentId).toBe(CLAUDE)
  })

  it('AWTD-1311: a poll still wins over a declaration, so a mailbox typo cannot mis-sign', async () => {
    // The poll is checked by the server, so it is the stronger claim. This keeps
    // the AWTD-878 precedence intact rather than letting a per-call argument
    // override what the API already confirmed.
    process.env.ASTRID_AGENT_ID_COPILOT = 'ai-agent-copilot'
    const fetchMock = vi.fn(async (url: string) =>
      String(url).includes('/agent-queue')
        ? jsonOk({ agent: { mailbox: 'claude', email: agentEmail('claude'), id: CLAUDE }, empty: true, queue: [] })
        : jsonOk({ comment: { id: 'c1' } }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const server = new AstridMCPServerOAuth({ accessToken: 'astrid_mcp_token' })

    await (server as any).getAgentQueue({ agent: 'claude' })
    await (server as any).addComment({ taskId: 'task-1', content: 'progress', agent: 'copilot' })

    expect(bodyOf(fetchMock, '/comments').aiAgentId).toBe(CLAUDE)
  })

  it('AWTD-1311: the write tools advertise `agent`, or no harness will ever pass it', async () => {
    // A rule nothing announces is a rule nobody follows. The tool schema is the
    // only documentation a harness reads.
    for (const name of ['add_comment', 'update_task']) {
      const tool = OAUTH_MCP_TOOLS.find(t => t.name === name) as
        | { name: string; inputSchema?: { properties?: Record<string, unknown> } }
        | undefined
      expect(tool, `${name} is not advertised`).toBeDefined()
      expect(
        tool!.inputSchema?.properties,
        `${name} must advertise an \`agent\` field`,
      ).toHaveProperty('agent')
    }
  })
})
