/**
 * RED for AWTD-970: comments written by the OAuth scripts were signed as Jon.
 *
 * Client-credentials auth resolves `auth.userId` to the client's OWNER, so every
 * comment posted without an `aiAgentId` carries Jon's name and face. AWTD-878
 * fixed that for the MCP server (`mcp/agent-identity.ts`); the script path was
 * left half-done — `add-task-comment.ts` and `post-session-link.ts` passed
 * `CLAUDE_AGENT_ID`, but `SweepApi.comment()` in `scripts/ready-tasks.ts`
 * POSTed `{ content }` and nothing else. Its two standing outputs — "📅
 * Scheduled for … — parked in Waiting" and "⏰ Condition met … — back to Ready"
 * — therefore appeared on the board as Jon, on every sweep, forever.
 *
 * Two things are asserted here that a narrower fix would miss:
 *
 * 1. The sweep runs under `--harness`, so the identity is per-MAILBOX. Reading
 *    `CLAUDE_AGENT_ID` unconditionally would sign Copilot's sweep as Claude —
 *    the failure `mcp/agent-identity.ts` already warns about for a stale
 *    `ASTRID_AGENT_ID`.
 * 2. An unresolved identity must send NO `aiAgentId` rather than a null one.
 *    `POST /api/v1/tasks/:id/comments` rejects an id it cannot resolve
 *    ("Invalid aiAgentId"), and a sweep that 400s instead of commenting is a
 *    worse outcome than one comment with the wrong byline.
 *
 * The sweep's writer is exercised directly rather than through the script
 * because `scripts/ready-tasks.ts` calls `main()` at import — the same reason
 * `lib/ready-queue-scope.ts` exists.
 */

import { describe, it, expect, vi } from 'vitest'
import { agentEmail } from '@/lib/brand/agent-emails'
import { resolveAgentAuthorId } from '../../scripts/lib/agent-author'
import { SweepApi } from '../../scripts/lib/sweep-api'

const TASK = { id: '11ff8e1c-eaac-456c-ba71-bd8d155fa3dc' }
const AUTH = { 'X-OAuth-Token': 'test-token' }

/** A fetch stub that records calls and answers 200 with `body`. */
function stubFetch(body: unknown = {}) {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status: 200 }))
}

function bodyOf(fetchMock: ReturnType<typeof stubFetch>, call = 0): Record<string, unknown> {
  const init = fetchMock.mock.calls[call]?.[1]
  return JSON.parse(String(init?.body))
}

describe('resolveAgentAuthorId (AWTD-970)', () => {
  it('AWTD-970: signs as the agent named by the per-mailbox env var', async () => {
    const fetchImpl = stubFetch()
    const authorId = await resolveAgentAuthorId({
      mailbox: 'claude',
      accessToken: 'test-token',
      env: { CLAUDE_AGENT_ID: 'ai-agent-claude' },
      fetchImpl,
    })

    expect(authorId).toBe('ai-agent-claude')
    // The env var is the whole answer; no lookup request is worth making.
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('AWTD-970: never signs one harness as another — CLAUDE_AGENT_ID is claude-only', async () => {
    // A Copilot sweep on a machine whose .env.local sets CLAUDE_AGENT_ID (which
    // is every machine that runs the Claude loop) must not write as Claude.
    const fetchImpl = stubFetch({ tasks: [{ assignee: { id: 'ai-agent-copilot' } }] })
    const authorId = await resolveAgentAuthorId({
      mailbox: 'copilot',
      accessToken: 'test-token',
      env: { CLAUDE_AGENT_ID: 'ai-agent-claude' },
      fetchImpl,
    })

    expect(authorId).toBe('ai-agent-copilot')
    expect(authorId).not.toBe('ai-agent-claude')
  })

  it('reads the generic per-mailbox override, so a new harness needs no code change', async () => {
    const fetchImpl = stubFetch()
    const authorId = await resolveAgentAuthorId({
      mailbox: 'codex',
      accessToken: 'test-token',
      env: { ASTRID_AGENT_ID_CODEX: 'ai-agent-codex' },
      fetchImpl,
    })

    expect(authorId).toBe('ai-agent-codex')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('falls back to looking the agent up by its identity address', async () => {
    const fetchImpl = stubFetch({ tasks: [{ assignee: { id: 'ai-agent-claude' } }] })
    const authorId = await resolveAgentAuthorId({
      mailbox: 'claude',
      accessToken: 'test-token',
      env: {},
      fetchImpl,
    })

    expect(authorId).toBe('ai-agent-claude')
    const [url, init] = fetchImpl.mock.calls[0]
    expect(String(url)).toContain(encodeURIComponent(agentEmail('claude')))
    expect((init?.headers as Record<string, string>)['X-OAuth-Token']).toBe('test-token')
  })

  it('AWTD-970: answers null rather than guessing when the agent cannot be resolved', async () => {
    // Guessing here would re-create the bug: the only id in scope is the OAuth
    // client owner's, which is exactly the wrong byline.
    const warn = vi.fn()
    const authorId = await resolveAgentAuthorId({
      mailbox: 'claude',
      accessToken: 'test-token',
      env: {},
      fetchImpl: stubFetch({ tasks: [] }),
      warn,
    })

    expect(authorId).toBeNull()
    expect(warn).toHaveBeenCalled()
  })
})

describe('SweepApi comment attribution (AWTD-970)', () => {
  it('AWTD-970: a parked-in-Waiting comment is signed by the agent, not the OAuth owner', async () => {
    const fetchImpl = stubFetch()
    const api = new SweepApi(AUTH, false, () => {}, 'ai-agent-claude', fetchImpl)

    await api.comment(TASK, '📅 Scheduled for 2026-09-25 — parked in Waiting.')

    expect(bodyOf(fetchImpl)).toMatchObject({ aiAgentId: 'ai-agent-claude' })
  })

  it('AWTD-970: omits aiAgentId entirely when the identity is unknown', async () => {
    // `null` would be rejected as "Invalid aiAgentId" and the sweep would post
    // nothing at all; absent means "sign as the caller", which still works.
    const fetchImpl = stubFetch()
    const api = new SweepApi(AUTH, false, () => {}, null, fetchImpl)

    await api.comment(TASK, '⏰ Condition met — back to Ready.')

    expect(bodyOf(fetchImpl)).not.toHaveProperty('aiAgentId')
  })

  it('still writes nothing at all under --dry-run', async () => {
    const fetchImpl = stubFetch()
    const api = new SweepApi(AUTH, true, () => {}, 'ai-agent-claude', fetchImpl)

    await api.comment(TASK, 'should not be sent')
    await api.setStatus(TASK, 'waiting')

    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
