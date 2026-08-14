/**
 * Task d8de37c1 — pins the GitHub comment sync route.
 *
 * Companion to tests/api/v1-sync-github-issue-description.test.ts, which pinned
 * the issue-body half. This route had no test either, and it carries the more
 * dangerous logic of the two.
 *
 * The pagination is not an optimisation. Its own comment records what happened
 * without it: a single ?per_page=100 page silently drops the newest comments on
 * a busy issue, the client sees them missing, concludes they were deleted
 * remotely, and deletes their Astrid twins — permanent local loss. So "fetches
 * every page" is a data-safety property, and it is asserted here rather than
 * trusted.
 *
 * The mapping is pinned for the same reason as the issue body: the client
 * compares fields it receives against local state and acts on the difference,
 * so a field that arrives null instead of '' is not a cosmetic difference.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: { externalListLink: { findFirst: vi.fn() } },
}))

vi.mock('@/lib/api-auth-middleware', () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    authenticateAPI: vi.fn(),
    requireScopes: vi.fn(),
    UnauthorizedError,
    ForbiddenError,
    getDeprecationWarning: vi.fn(() => null),
  }
})

const githubRequest = vi.hoisted(() => vi.fn())
vi.mock('@/lib/sync/github', () => ({
  githubRequest,
  githubTokenFor: vi.fn(async () => 'gh-token'),
  isValidRepoId: (id: string) => /^[^/]+\/[^/]+$/.test(id),
}))

import { GET } from '@/app/api/v1/sync/github/comments/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI } from '@/lib/api-auth-middleware'

const mockPrisma = vi.mocked(prisma)
const mockAuth = vi.mocked(authenticateAPI)

const auth = {
  userId: 'user-1',
  source: 'oauth' as const,
  scopes: ['tasks:read', 'tasks:write'],
  isAIAgent: false,
  user: { id: 'user-1', email: 'jon@example.com', name: 'Jon', isAIAgent: false },
}

const link = {
  id: 'link-1',
  userId: 'user-1',
  remoteContainerId: 'Graceful-Tools/astrid-web',
}

function req(qs: string) {
  return new NextRequest(`http://localhost/api/v1/sync/github/comments${qs}`)
}

function ghComment(n: number, overrides: Record<string, unknown> = {}) {
  return {
    id: n,
    body: `comment ${n}`,
    user: { login: 'jon' },
    created_at: '2026-08-14T00:00:00Z',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(auth as never)
  mockPrisma.externalListLink.findFirst.mockResolvedValue(link as never)
})

describe('GET comments — pagination is a data-safety property (task d8de37c1)', () => {
  it('fetches every page when the first comes back full', async () => {
    // 100 then 3. Stopping at the first page would hide the newest three, and
    // the client deletes what it cannot see.
    githubRequest
      .mockResolvedValueOnce({ status: 200, json: Array.from({ length: 100 }, (_, i) => ghComment(i + 1)) })
      .mockResolvedValueOnce({ status: 200, json: [ghComment(101), ghComment(102), ghComment(103)] })

    const payload = await (await GET(req('?linkId=link-1&remoteId=Graceful-Tools/astrid-web%237'))).json()

    expect(githubRequest).toHaveBeenCalledTimes(2)
    expect(payload.comments).toHaveLength(103)
    expect(payload.comments.at(-1).id).toBe('103')
  })

  it('stops as soon as a page comes back short', async () => {
    githubRequest.mockResolvedValue({ status: 200, json: [ghComment(1)] })

    await GET(req('?linkId=link-1&remoteId=Graceful-Tools/astrid-web%237'))

    expect(githubRequest).toHaveBeenCalledTimes(1)
  })

  it('asks for the pages in order, 100 at a time', async () => {
    githubRequest
      .mockResolvedValueOnce({ status: 200, json: Array.from({ length: 100 }, (_, i) => ghComment(i + 1)) })
      .mockResolvedValueOnce({ status: 200, json: [] })

    await GET(req('?linkId=link-1&remoteId=Graceful-Tools/astrid-web%237'))

    expect(githubRequest.mock.calls[0][2]).toContain('per_page=100&page=1')
    expect(githubRequest.mock.calls[1][2]).toContain('page=2')
  })
})

describe('GET comments — the shape the client compares against (task d8de37c1)', () => {
  it('maps id, body, author and createdAt', async () => {
    githubRequest.mockResolvedValue({ status: 200, json: [ghComment(7)] })

    const payload = await (await GET(req('?linkId=link-1&remoteId=Graceful-Tools/astrid-web%237'))).json()

    expect(payload.comments[0]).toEqual({
      id: '7',
      body: 'comment 7',
      author: 'jon',
      createdAt: '2026-08-14T00:00:00Z',
    })
  })

  it('sends an empty body as "" rather than null', async () => {
    // GitHub allows an empty comment body. The client compares bodies to decide
    // what changed, so null and '' must not both be possible for "no text".
    githubRequest.mockResolvedValue({ status: 200, json: [ghComment(1, { body: null })] })

    const payload = await (await GET(req('?linkId=link-1&remoteId=Graceful-Tools/astrid-web%237'))).json()

    expect(payload.comments[0].body).toBe('')
  })

  it('falls back to "unknown" when GitHub omits the author', async () => {
    // Deleted accounts come back with a null user. Without the fallback the
    // field is undefined and disappears from the JSON entirely.
    githubRequest.mockResolvedValue({ status: 200, json: [ghComment(1, { user: null })] })

    const payload = await (await GET(req('?linkId=link-1&remoteId=Graceful-Tools/astrid-web%237'))).json()

    expect(payload.comments[0].author).toBe('unknown')
  })

  it('stringifies the numeric GitHub id', async () => {
    githubRequest.mockResolvedValue({ status: 200, json: [ghComment(42)] })

    const payload = await (await GET(req('?linkId=link-1&remoteId=Graceful-Tools/astrid-web%237'))).json()

    expect(payload.comments[0].id).toBe('42')
  })
})

describe('GET comments — refuses bad input before calling GitHub (task d8de37c1)', () => {
  it('requires both linkId and remoteId', async () => {
    expect((await GET(req('?linkId=link-1'))).status).toBe(400)
    expect((await GET(req('?remoteId=x%231'))).status).toBe(400)
    expect(githubRequest).not.toHaveBeenCalled()
  })

  it('404s a link that is not the caller\'s', async () => {
    mockPrisma.externalListLink.findFirst.mockResolvedValue(null as never)

    expect((await GET(req('?linkId=someone-elses&remoteId=x/y%231'))).status).toBe(404)
    expect(githubRequest).not.toHaveBeenCalled()
  })

  it('rejects a remoteId with no issue number', async () => {
    expect((await GET(req('?linkId=link-1&remoteId=Graceful-Tools/astrid-web%23abc'))).status).toBe(400)
    expect(githubRequest).not.toHaveBeenCalled()
  })
})
