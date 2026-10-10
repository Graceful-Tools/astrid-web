/**
 * AWTD-1116 P5a: the GitHub backend writes edits through, as the acting user.
 *
 *   - every write goes out on the ACTING user's client — never the
 *     installation's (exit criterion: "every write is attributed");
 *   - no usable user token → auth_required, and nothing is sent or written;
 *   - only GitHub-owned changes go to GitHub; Astrid-only edits pass locally;
 *   - a body edit on a stale remoteVersion is a 409 conflict, sent nowhere;
 *   - GitHub's answer becomes the replica's new remoteVersion;
 *   - GitHub failures map to v1 codes: forbidden, rate_limited, sso_required,
 *     upstream_unavailable.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const db = vi.hoisted(() => ({ task: { findUnique: vi.fn() } }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { createGithubProjectTaskBackend, GITHUB_PROJECT_READ_ONLY } from '@/lib/backends/github-project'
import { createBudget, createGraphqlClient, memoryBudgetStore } from '@/lib/github/rate-limiter'

const load = (name: string) =>
  JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/github/graphql', name), 'utf8'))
const binding = load('binding-graceful-fools.json')

const mirrored = (over: Record<string, unknown> = {}) => ({
  remoteNodeId: 'I_kwDOVCns8c8AAAABWTcnYA',
  remoteKind: 'issue',
  remoteVersion: '2026-10-10T14:46:32Z',
  title: '[Astrid sync fixture] Open issue in Todo',
  description: 'body',
  completed: false,
  closedReason: null,
  statusRole: 'ready',
  priority: 0,
  dueDateTime: null,
  githubProjectItems: [
    {
      itemNodeId: 'PVTI_lADOFEb-HM4BmXS2zg_2m1A',
      binding: { projectNodeId: 'PVT_kwDOFEb-HM4BmXS2', detachedAt: null, ...binding },
    },
  ],
  ...over,
})

/** A user client replaying bodies in order, recording what it was sent. */
function userClientReplaying(...responses: Array<{ body: unknown; status?: number; headers?: Record<string, string> }>) {
  const sent: Array<{ query: string; variables: Record<string, unknown> }> = []
  const queue = [...responses]
  const client = createGraphqlClient({
    token: 'ghu_ACTING_USER',
    bucket: 'user:u1',
    priority: 'write',
    budget: createBudget(memoryBudgetStore()),
    sleep: async () => {},
    fetch: vi.fn(async (_url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>).authorization).toBe('bearer ghu_ACTING_USER')
      sent.push(JSON.parse(String(init.body)))
      const next = queue.shift()!
      return new Response(JSON.stringify(next.body), { status: next.status ?? 200, headers: next.headers })
    }) as never,
  })
  return { client, sent }
}

const ctx = { actorId: 'u1' }

beforeEach(() => {
  vi.clearAllMocks()
  db.task.findUnique.mockResolvedValue(mirrored())
})

describe('write-through (AWTD-1116 P5a)', () => {
  it('sends a title + lane change as one document on the acting user’s client, and stores GitHub’s version', async () => {
    const { client, sent } = userClientReplaying({ body: load('write-issue-title-status.json') })
    const userClient = vi.fn(async () => client)
    const backend = createGithubProjectTaskBackend({ userClient })

    const result = await backend.updateTask(ctx, 't1', { title: 'Renamed', statusRole: 'doing' })

    expect(userClient).toHaveBeenCalledWith('u1')
    expect(sent).toHaveLength(1)
    expect(sent[0].query).toMatch(/m0: updateIssue.*m1: updateProjectV2ItemFieldValue/)
    expect(result).toEqual({
      ok: true,
      value: { title: 'Renamed', statusRole: 'doing', remoteVersion: '2026-10-10T14:46:32Z' },
    })
  })

  it('no usable user token → auth_required, and GitHub is never called (never the installation)', async () => {
    const backend = createGithubProjectTaskBackend({ userClient: async () => null })
    expect(await backend.updateTask(ctx, 't1', { title: 'Renamed' })).toEqual({
      ok: false,
      status: 403,
      error: 'auth_required',
    })
  })

  it('an Astrid-only edit passes locally without asking for a token', async () => {
    const userClient = vi.fn()
    const backend = createGithubProjectTaskBackend({ userClient })
    const data = { reminderTime: new Date(), title: '[Astrid sync fixture] Open issue in Todo' }

    expect(await backend.updateTask(ctx, 't1', data)).toEqual({ ok: true, value: data })
    expect(userClient).not.toHaveBeenCalled()
  })

  it('a body edit on a stale version is a 409 conflict, and nothing is sent', async () => {
    const { client, sent } = userClientReplaying({
      body: { data: { node: { updatedAt: '2026-10-10T15:00:00Z' }, rateLimit: { cost: 1, remaining: 1, resetAt: '2026-10-10T16:00:00Z' } } },
    })
    const backend = createGithubProjectTaskBackend({ userClient: async () => client })

    expect(await backend.updateTask(ctx, 't1', { description: 'my paragraph' })).toEqual({
      ok: false,
      status: 409,
      error: 'conflict',
    })
    expect(sent).toHaveLength(1) // the version check only
  })

  it('a body edit on the current version goes through', async () => {
    const { client, sent } = userClientReplaying(
      { body: { data: { node: { updatedAt: '2026-10-10T14:46:32Z' }, rateLimit: { cost: 1, remaining: 1, resetAt: '2026-10-10T16:00:00Z' } } } },
      { body: load('write-issue-title-status.json') },
    )
    const backend = createGithubProjectTaskBackend({ userClient: async () => client })

    expect(await backend.updateTask(ctx, 't1', { description: 'my paragraph' })).toMatchObject({ ok: true })
    expect(sent[1].variables).toMatchObject({ m0_body: 'my paragraph' })
  })

  it('a GitHub error in the mutation fails the write (strict), as forbidden', async () => {
    const { client } = userClientReplaying({ body: load('write-error-not-found.json') })
    const backend = createGithubProjectTaskBackend({ userClient: async () => client })
    expect(await backend.updateTask(ctx, 't1', { title: 'x' })).toEqual({ ok: false, status: 403, error: 'forbidden' })
  })

  it('SAML SSO required → sso_required with the URL', async () => {
    const { client } = userClientReplaying({
      body: { message: 'Resource protected by organization SAML enforcement.' },
      status: 403,
      headers: { 'x-github-sso': 'required; url=https://github.com/orgs/acme/sso?authorization_request=abc' },
    })
    const backend = createGithubProjectTaskBackend({ userClient: async () => client })
    expect(await backend.updateTask(ctx, 't1', { title: 'x' })).toEqual({
      ok: false,
      status: 403,
      error: 'sso_required',
      ssoUrl: 'https://github.com/orgs/acme/sso?authorization_request=abc',
    })
  })

  it('a secondary rate limit that will not clear soon → 429 rate_limited with retryAfter', async () => {
    const limited = { body: {}, status: 429, headers: { 'retry-after': '120' } }
    const { client } = userClientReplaying(limited)
    const backend = createGithubProjectTaskBackend({ userClient: async () => client })
    expect(await backend.updateTask(ctx, 't1', { title: 'x' })).toEqual({
      ok: false,
      status: 429,
      error: 'rate_limited',
      retryAfter: 120,
    })
  })

  it('GitHub down → 502 upstream_unavailable', async () => {
    const { client } = userClientReplaying({ body: {}, status: 503 })
    const backend = createGithubProjectTaskBackend({ userClient: async () => client })
    expect(await backend.updateTask(ctx, 't1', { title: 'x' })).toEqual({ ok: false, status: 502, error: 'upstream_unavailable' })
  })

  it('an unbound field is a 400 naming it', async () => {
    const backend = createGithubProjectTaskBackend({ userClient: vi.fn() })
    expect(await backend.updateTask(ctx, 't1', { priority: 3 })).toEqual({ ok: false, status: 400, error: 'github_field_not_bound' })
  })

  it('a board whose installation was uninstalled or suspended is read-only', async () => {
    db.task.findUnique.mockResolvedValue(
      mirrored({ githubProjectItems: [{ itemNodeId: 'x', binding: { projectNodeId: 'p', detachedAt: new Date(), ...binding } }] }),
    )
    const backend = createGithubProjectTaskBackend({ userClient: vi.fn() })
    expect(await backend.updateTask(ctx, 't1', { title: 'x' })).toEqual({ ok: false, status: 403, error: GITHUB_PROJECT_READ_ONLY })
  })

  it('the backend module never reaches for the App or an installation token (§8.6)', () => {
    const source = readFileSync(join(process.cwd(), 'lib/backends/github-project.ts'), 'utf8')
    expect(source).not.toMatch(/installationGraphqlClient|getGitHubApp|type: 'installation'/)
  })
})
