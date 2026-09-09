/**
 * The module that decides whether a request may read or write a task (AWTD-866).
 *
 * `lib/api-auth-middleware.ts` had NO test file. `tests/lib/api-auth-wrapper.test.ts`
 * covers the wrapper around it and mocks this module out entirely, so the wrapper's
 * green tests said nothing at all about the checks themselves — 16.4% statements on
 * the surface AWTD-777 found a credential bug in.
 *
 * It was also, until AWTD-811, outside the risk-coverage gate: the include list named
 * `lib/task-read-access.ts`, a file that does not exist, and vitest treats an include
 * that matches nothing as nothing. A threshold over a missing file is met trivially.
 * So the gate reported 68% while never looking at this module.
 *
 * The tests are ordered by what an attacker would try, not by what is easy to cover.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockPrisma } from '@/tests/setup'

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/auth-config', () => ({ authConfig: {} }))
vi.mock('@/lib/oauth/oauth-token-manager', () => ({ validateAccessToken: vi.fn() }))
vi.mock('@/lib/ai/ensure-agent-user', () => ({ ensureAgentUser: vi.fn() }))

import { getServerSession } from 'next-auth'
import { validateAccessToken } from '@/lib/oauth/oauth-token-manager'
import { ensureAgentUser } from '@/lib/ai/ensure-agent-user'
import {
  authenticateAPI,
  requireScopes,
  getDeprecationWarning,
  requireListAccess,
  requireTaskAccess,
  requireTaskReadAccess,
  UnauthorizedError,
  ForbiddenError,
  type AuthContext,
} from '@/lib/api-auth-middleware'
import { BRAND } from '@/lib/brand/config'

const PERSON = { id: 'u1', email: 'u@example.com', name: 'U', isAIAgent: false }
const AGENT = { id: 'a1', email: `claude@${BRAND.agentEmailDomain}`, name: 'Claude', isAIAgent: true }

/** A NextRequest as far as this module is concerned: headers and cookies. */
function req(headers: Record<string, string> = {}, cookies: Record<string, string> = {}) {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  return {
    headers: { get: (name: string) => lower.get(name.toLowerCase()) ?? null },
    cookies: { get: (name: string) => (name in cookies ? { value: cookies[name] } : undefined) },
  } as never
}

beforeEach(() => {
  vi.mocked(getServerSession).mockReset().mockResolvedValue(null)
  vi.mocked(validateAccessToken).mockReset().mockResolvedValue(null)
  vi.mocked(ensureAgentUser).mockReset().mockResolvedValue(null)
  mockPrisma.session.findUnique.mockReset().mockResolvedValue(null)
  mockPrisma.user.findUnique.mockReset().mockResolvedValue(null)
  mockPrisma.mCPToken.findFirst.mockReset().mockResolvedValue(null)
  mockPrisma.mCPToken.update.mockReset().mockResolvedValue({})
  mockPrisma.task.findFirst.mockReset().mockResolvedValue(null)
  mockPrisma.taskList.findFirst.mockReset().mockResolvedValue(null)
})

/**
 * The ORDER is the security property.
 *
 * Three mechanisms are tried OAuth → session → legacy MCP. If a later one could
 * override an earlier one, a stale session cookie would beat a live OAuth token,
 * and a deprecated MCP token would beat both — which is the opposite of a
 * deprecation. Each step is pinned by making a LATER mechanism also valid and
 * asserting the earlier one still wins.
 */
describe('authenticateAPI — the priority ladder', () => {
  it('prefers a valid OAuth token over a valid session', async () => {
    vi.mocked(validateAccessToken).mockResolvedValue({
      userId: 'u1', scopes: ['tasks:read'], clientId: 'c1', user: PERSON, agentUser: null,
    } as never)
    // A session is ALSO available. It must not win.
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'someone-else' } } as never)

    const auth = await authenticateAPI(req({ authorization: 'Bearer astrid_live' }))

    expect(auth.source).toBe('oauth')
    expect(auth.userId).toBe('u1')
    expect(auth.scopes).toEqual(['tasks:read'])
    expect(auth.clientId).toBe('c1')
  })

  it('falls through to the session when the OAuth token is present but INVALID', async () => {
    // The dangerous alternative is returning early with no identity, or worse,
    // treating "a token was supplied" as authentication in itself.
    vi.mocked(validateAccessToken).mockResolvedValue(null)
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as never)
    mockPrisma.user.findUnique.mockResolvedValue(PERSON)

    const auth = await authenticateAPI(req({ authorization: 'Bearer astrid_expired' }))

    expect(auth.source).toBe('session')
    expect(auth.scopes).toEqual(['*'])
  })

  it('prefers a session over a legacy MCP token', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as never)
    mockPrisma.user.findUnique.mockResolvedValue(PERSON)
    mockPrisma.mCPToken.findFirst.mockResolvedValue({
      id: 't1', userId: 'other', user: PERSON, agentUser: null, agentMailbox: null,
    })

    const auth = await authenticateAPI(req({ 'x-mcp-access-token': 'astrid_mcp_x' }))

    expect(auth.source).toBe('session')
  })

  it('accepts a session cookie directly when getServerSession finds nothing', async () => {
    // The iOS/mobile path: the cookie is present but next-auth's own helper does
    // not see it, so the module reads the Session row itself.
    vi.mocked(getServerSession).mockResolvedValue(null)
    mockPrisma.session.findUnique.mockResolvedValue({
      expires: new Date(Date.now() + 60_000),
      user: PERSON,
    })
    mockPrisma.user.findUnique.mockResolvedValue(PERSON)

    const auth = await authenticateAPI(req({}, { 'next-auth.session-token': 'sess' }))

    expect(auth.source).toBe('session')
    expect(auth.userId).toBe('u1')
  })

  it('rejects an EXPIRED session cookie', async () => {
    mockPrisma.session.findUnique.mockResolvedValue({
      expires: new Date(Date.now() - 60_000),
      user: PERSON,
    })

    await expect(
      authenticateAPI(req({}, { 'next-auth.session-token': 'stale' }))
    ).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('accepts the __Secure- cookie name too', async () => {
    mockPrisma.session.findUnique.mockResolvedValue({
      expires: new Date(Date.now() + 60_000),
      user: PERSON,
    })
    mockPrisma.user.findUnique.mockResolvedValue(PERSON)

    const auth = await authenticateAPI(
      req({}, { '__Secure-next-auth.session-token': 'sess' })
    )
    expect(auth.source).toBe('session')
  })

  it('throws Unauthorized when nothing authenticates', async () => {
    await expect(authenticateAPI(req())).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('does not authenticate a session whose user row is gone', async () => {
    // A deleted account with a live cookie must not become an identity.
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'ghost' } } as never)
    mockPrisma.user.findUnique.mockResolvedValue(null)

    await expect(authenticateAPI(req())).rejects.toBeInstanceOf(UnauthorizedError)
  })
})

/**
 * Both extractors read `Authorization: Bearer`, and the ONLY thing separating
 * them is the `astrid_mcp_` prefix. Get that wrong in either direction and a
 * deprecated legacy token is silently accepted as a modern OAuth one, or a real
 * OAuth token is routed into the legacy path and its scopes replaced by `*`.
 */
describe('authenticateAPI — telling the two bearer token kinds apart', () => {
  it('does NOT treat an astrid_mcp_ bearer as an OAuth token', async () => {
    mockPrisma.mCPToken.findFirst.mockResolvedValue({
      id: 't1', userId: 'u1', user: PERSON, agentUser: null, agentMailbox: null,
    })

    const auth = await authenticateAPI(req({ authorization: 'Bearer astrid_mcp_legacy' }))

    // Routed to the legacy path, and the OAuth validator was never consulted.
    expect(auth.source).toBe('legacy_mcp')
    expect(validateAccessToken).not.toHaveBeenCalled()
  })

  it('requires the astrid_ prefix on X-OAuth-Token', async () => {
    // A bare token in that header is not an OAuth token, and must not be sent
    // to the validator as though it might be.
    await expect(
      authenticateAPI(req({ 'x-oauth-token': 'not-a-prefixed-token' }))
    ).rejects.toBeInstanceOf(UnauthorizedError)
    expect(validateAccessToken).not.toHaveBeenCalled()
  })

  it('accepts X-OAuth-Token with the prefix', async () => {
    vi.mocked(validateAccessToken).mockResolvedValue({
      userId: 'u1', scopes: ['*'], clientId: 'c1', user: PERSON, agentUser: null,
    } as never)

    const auth = await authenticateAPI(req({ 'x-oauth-token': 'astrid_abc' }))
    expect(auth.source).toBe('oauth')
  })

  it('matches the Bearer scheme case-insensitively', async () => {
    vi.mocked(validateAccessToken).mockResolvedValue({
      userId: 'u1', scopes: ['*'], clientId: 'c1', user: PERSON, agentUser: null,
    } as never)

    const auth = await authenticateAPI(req({ authorization: 'bearer astrid_abc' }))
    expect(auth.source).toBe('oauth')
  })

  it('accepts a legacy token from the request BODY, for old iOS builds', async () => {
    mockPrisma.mCPToken.findFirst.mockResolvedValue({
      id: 't1', userId: 'u1', user: PERSON, agentUser: null, agentMailbox: null,
    })

    const auth = await authenticateAPI(req(), 'astrid_mcp_from_body')
    expect(auth.source).toBe('legacy_mcp')
  })

  it('gives a legacy MCP session full scopes and carries its agent identity', async () => {
    mockPrisma.mCPToken.findFirst.mockResolvedValue({
      id: 't1', userId: 'u1', user: PERSON, agentUser: AGENT, agentMailbox: null,
    })

    const auth = await authenticateAPI(req({ 'x-mcp-access-token': 'astrid_mcp_x' }))

    expect(auth.scopes).toEqual(['*'])
    expect(auth.agentUser).toEqual(AGENT)
  })
})

/**
 * A token that has expired or been deactivated must not authenticate. The filter
 * is in the QUERY rather than in a branch afterwards, so the query is what gets
 * asserted — a check written after the fetch would be one refactor away from
 * being dropped.
 */
describe('validateMCPToken — expiry, deactivation, and the agent backfill', () => {
  it('asks only for active, unexpired tokens', async () => {
    await authenticateAPI(req({ 'x-mcp-access-token': 'astrid_mcp_x' })).catch(() => {})

    const where = mockPrisma.mCPToken.findFirst.mock.calls[0][0].where
    expect(where.isActive).toBe(true)
    // Null expiry means "never expires"; anything else must still be in the future.
    expect(where.OR).toEqual([
      { expiresAt: null },
      { expiresAt: { gt: expect.any(Date) } },
    ])
  })

  it('backfills the agent user for a token that carries only a mailbox', async () => {
    // Tokens predate agentUserId. Resolving the mailbox and WRITING THE ID BACK
    // is what stops every later request paying for the same lookup.
    mockPrisma.mCPToken.findFirst.mockResolvedValue({
      id: 't1', userId: 'u1', user: PERSON, agentUser: null, agentMailbox: 'claude',
    })
    vi.mocked(ensureAgentUser).mockResolvedValue({
      id: 'a1', email: AGENT.email, name: 'Claude',
    } as never)

    const auth = await authenticateAPI(req({ 'x-mcp-access-token': 'astrid_mcp_x' }))

    expect(auth.agentUser).toMatchObject({ id: 'a1', isAIAgent: true })
    expect(mockPrisma.mCPToken.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { agentUserId: 'a1' },
    })
  })

  it('does not re-resolve a mailbox when the token already has its agent user', async () => {
    mockPrisma.mCPToken.findFirst.mockResolvedValue({
      id: 't1', userId: 'u1', user: PERSON, agentUser: AGENT, agentMailbox: 'claude',
    })

    await authenticateAPI(req({ 'x-mcp-access-token': 'astrid_mcp_x' }))

    expect(ensureAgentUser).not.toHaveBeenCalled()
    expect(mockPrisma.mCPToken.update).not.toHaveBeenCalled()
  })

  it('still authenticates when the mailbox cannot be resolved', async () => {
    // A missing agent row is not a reason to reject the human's token.
    mockPrisma.mCPToken.findFirst.mockResolvedValue({
      id: 't1', userId: 'u1', user: PERSON, agentUser: null, agentMailbox: 'claude',
    })
    vi.mocked(ensureAgentUser).mockResolvedValue(null)

    const auth = await authenticateAPI(req({ 'x-mcp-access-token': 'astrid_mcp_x' }))
    expect(auth.source).toBe('legacy_mcp')
    expect(auth.agentUser).toBeNull()
  })
})

/**
 * THE invariant in this file.
 *
 * `requireTaskAccess` guards PUT and DELETE; `requireTaskReadAccess` guards GET.
 * They share `taskMembershipBranches` and differ by exactly one clause: reads
 * also allow a task sitting on a PUBLIC list.
 *
 * The comment above the write check says not to add a public branch there — a
 * stranger who can READ a task on a public list must not thereby be able to edit
 * or delete it. A comment is not enforcement, so it is asserted here in both
 * directions: the write query must contain no PUBLIC branch, and the read query
 * must contain one. Either half alone would let the pair drift back together.
 */
describe('requireTaskAccess vs requireTaskReadAccess — the public-list asymmetry', () => {
  it('the WRITE check has no PUBLIC-list branch', async () => {
    mockPrisma.task.findFirst.mockResolvedValue({ id: 't1' })
    await requireTaskAccess('u1', 't1')

    const where = mockPrisma.task.findFirst.mock.calls[0][0].where
    expect(JSON.stringify(where)).not.toContain('PUBLIC')
    expect(where.OR).toHaveLength(3)
  })

  it('the READ check does have one', async () => {
    mockPrisma.task.findFirst.mockResolvedValue({ id: 't1' })
    await requireTaskReadAccess('u1', 't1')

    const where = mockPrisma.task.findFirst.mock.calls[0][0].where
    expect(where.OR).toHaveLength(4)
    expect(where.OR[3]).toEqual({ lists: { some: { privacy: 'PUBLIC' } } })
  })

  it('both accept the same three membership routes: creator, assignee, list member', async () => {
    mockPrisma.task.findFirst.mockResolvedValue({ id: 't1' })
    await requireTaskAccess('u1', 't1')
    await requireTaskReadAccess('u1', 't1')

    const [write, read] = mockPrisma.task.findFirst.mock.calls.map(c => c[0].where)
    for (const where of [write, read]) {
      expect(where.OR[0]).toEqual({ creatorId: 'u1' })
      expect(where.OR[1]).toEqual({ assigneeId: 'u1' })
      expect(JSON.stringify(where.OR[2])).toContain('listMembers')
    }
    // The shared prefix is identical — they diverge only at the tail.
    expect(JSON.stringify(read.OR.slice(0, 3))).toBe(JSON.stringify(write.OR))
  })

  it('both refuse with Forbidden when no row matches', async () => {
    mockPrisma.task.findFirst.mockResolvedValue(null)
    await expect(requireTaskAccess('stranger', 't1')).rejects.toBeInstanceOf(ForbiddenError)
    await expect(requireTaskReadAccess('stranger', 't1')).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe('requireListAccess — asking for a role means requiring it', () => {
  it('does not constrain the role for plain membership', async () => {
    mockPrisma.taskList.findFirst.mockResolvedValue({ id: 'l1' })
    await requireListAccess('u1', 'l1')

    const some = mockPrisma.taskList.findFirst.mock.calls[0][0].where.OR[1].listMembers.some
    expect(some).toEqual({ userId: 'u1' })
  })

  it('constrains it for admin, so membership alone cannot satisfy an admin check', async () => {
    mockPrisma.taskList.findFirst.mockResolvedValue({ id: 'l1' })
    await requireListAccess('u1', 'l1', 'admin')

    const some = mockPrisma.taskList.findFirst.mock.calls[0][0].where.OR[1].listMembers.some
    expect(some).toEqual({ userId: 'u1', role: 'admin' })
  })

  it('always lets the owner through, whatever role was asked for', async () => {
    mockPrisma.taskList.findFirst.mockResolvedValue({ id: 'l1' })
    await requireListAccess('u1', 'l1', 'owner')

    expect(mockPrisma.taskList.findFirst.mock.calls[0][0].where.OR[0]).toEqual({ ownerId: 'u1' })
  })

  it('refuses with Forbidden when no row matches', async () => {
    mockPrisma.taskList.findFirst.mockResolvedValue(null)
    await expect(requireListAccess('u1', 'l1')).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe('requireScopes and getDeprecationWarning', () => {
  const auth = (scopes: string[], source: AuthContext['source'] = 'oauth'): AuthContext => ({
    userId: 'u1', source, scopes, isAIAgent: false, user: PERSON,
  })

  it('passes when the scope is held', () => {
    expect(() => requireScopes(auth(['tasks:read']), ['tasks:read'])).not.toThrow()
  })

  it('throws Forbidden, naming what was missing', () => {
    expect(() => requireScopes(auth(['tasks:read']), ['tasks:write'])).toThrow(ForbiddenError)
    expect(() => requireScopes(auth(['tasks:read']), ['tasks:write'])).toThrow(/tasks:write/)
  })

  it('warns only for the deprecated mechanism', () => {
    expect(getDeprecationWarning(auth(['*'], 'legacy_mcp'))).toContain('deprecated')
    expect(getDeprecationWarning(auth(['*'], 'oauth'))).toBeNull()
    expect(getDeprecationWarning(auth(['*'], 'session'))).toBeNull()
  })

  it('points the warning at this deployment, not a hardcoded host', () => {
    // A partner build must send its own users to its own docs.
    expect(getDeprecationWarning(auth(['*'], 'legacy_mcp'))).toContain(BRAND.domain)
  })
})
