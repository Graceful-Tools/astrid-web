/**
 * Task d8de37c1 — pins the field that carries a task's description across the
 * GitHub issue sync, in both directions.
 *
 * The sync works today, but nothing was checking it: this route had no test at
 * all, and the description travels under a DIFFERENT NAME in each direction —
 * GitHub's `body` becomes our `notes` on the way in, and our `body` becomes
 * GitHub's `body` on the way out. An asymmetry like that survives a refactor
 * only by luck.
 *
 * The failure this prevents is quiet. Rename or drop `notes` in the GET
 * mapping and the sync keeps running, keeps reporting success, and silently
 * stops carrying descriptions — every issue arrives with an empty body and
 * iOS, which compares `(item.notes ?? "") != task.description`, dutifully
 * blanks the local description to match.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    externalListLink: { findFirst: vi.fn(), update: vi.fn() },
    integration: { findUnique: vi.fn() },
    user: { findMany: vi.fn() },
  },
}))

vi.mock('@/lib/api-auth-middleware', () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    authenticateAPI: vi.fn(),
    requireScopes: vi.fn(),
    requireTaskAccess: vi.fn(),
    UnauthorizedError,
    ForbiddenError,
    getDeprecationWarning: vi.fn(() => null),
  }
})

const githubRequest = vi.hoisted(() => vi.fn())
const githubGraphQL = vi.hoisted(() => vi.fn())
vi.mock('@/lib/sync/github', () => ({
  githubRequest,
  githubGraphQL,
  githubTokenFor: vi.fn(async () => 'gh-token'),
  isValidRepoId: (id: string) => /^[^/]+\/[^/]+$/.test(id),
}))

import { GET, POST } from '@/app/api/v1/sync/github/issues/route'
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
  cursor: null,
}

function getReq(qs = '?linkId=link-1') {
  return new NextRequest(`http://localhost/api/v1/sync/github/issues${qs}`)
}

function postReq(body: unknown) {
  return new NextRequest('http://localhost/api/v1/sync/github/issues', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function issue(overrides: Record<string, unknown> = {}) {
  return {
    number: 7,
    title: 'Fix the thing',
    body: 'The description that has to survive the round trip.',
    state: 'open',
    closed_at: null,
    state_reason: null,
    updated_at: '2026-08-14T00:00:00Z',
    comments: 0,
    labels: [],
    assignees: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(auth as never)
  mockPrisma.externalListLink.findFirst.mockResolvedValue(link as never)
  mockPrisma.externalListLink.update.mockResolvedValue(link as never)
  mockPrisma.user.findMany.mockResolvedValue([] as never)
  githubGraphQL.mockResolvedValue({ status: 200, json: { data: {} } })
})

describe('GitHub issue -> task description (task d8de37c1)', () => {
  it('carries the issue body across as `notes`', async () => {
    githubRequest.mockResolvedValue({ status: 200, json: [issue()] })

    const res = await GET(getReq())
    const payload = await res.json()

    expect(payload.items).toHaveLength(1)
    expect(payload.items[0].notes).toBe('The description that has to survive the round trip.')
    expect(payload.items[0].title).toBe('Fix the thing')
  })

  it('maps an EMPTY issue body to null rather than dropping the field', async () => {
    // The field has to be present-and-null, not absent. iOS reads
    // `item.notes ?? ""`, so an absent key and an empty body must agree.
    githubRequest.mockResolvedValue({ status: 200, json: [issue({ body: null })] })

    const payload = await (await GET(getReq())).json()

    expect(payload.items[0]).toHaveProperty('notes')
    expect(payload.items[0].notes).toBeNull()
  })

  it('preserves markdown and newlines untouched', async () => {
    // Descriptions are markdown on both sides; anything that "cleans" them
    // here would rewrite every synced task on the next pass.
    const markdown = '## Heading\n\n- item one\n- item two\n\n```ts\nconst x = 1\n```'
    githubRequest.mockResolvedValue({ status: 200, json: [issue({ body: markdown })] })

    const payload = await (await GET(getReq())).json()

    expect(payload.items[0].notes).toBe(markdown)
  })

  it('excludes pull requests, which would otherwise arrive as tasks', async () => {
    githubRequest.mockResolvedValue({
      status: 200,
      json: [issue(), issue({ number: 8, pull_request: { url: 'x' } })],
    })

    const payload = await (await GET(getReq())).json()

    expect(payload.items).toHaveLength(1)
    expect(payload.items[0].remoteId).toBe('Graceful-Tools/astrid-web#7')
  })
})

describe('task description -> GitHub issue (task d8de37c1)', () => {
  it('sends the description as `body` when creating an issue', async () => {
    githubRequest.mockResolvedValue({
      status: 201,
      json: { number: 9, id: 900, updated_at: '2026-08-14T00:00:00Z' },
    })

    await POST(postReq({ linkId: 'link-1', title: 'New', body: 'Fresh description' }))

    const [, method, path, payload] = githubRequest.mock.calls[0]
    expect(method).toBe('POST')
    expect(path).toBe('/repos/Graceful-Tools/astrid-web/issues')
    expect(payload.body).toBe('Fresh description')
  })

  it('sends the description as `body` when updating an existing issue', async () => {
    githubRequest.mockResolvedValue({
      status: 200,
      json: { number: 7, updated_at: '2026-08-14T00:00:00Z' },
    })

    await POST(postReq({
      linkId: 'link-1',
      remoteId: 'Graceful-Tools/astrid-web#7',
      title: 'Fix the thing',
      body: 'Edited description',
    }))

    const [, method, path, payload] = githubRequest.mock.calls[0]
    expect(method).toBe('PATCH')
    expect(path).toBe('/repos/Graceful-Tools/astrid-web/issues/7')
    expect(payload.body).toBe('Edited description')
  })

  it('refuses a remoteId whose repo does not match the link', async () => {
    // Already-guarded behaviour, pinned here because this test file is the
    // only coverage this route has: a mismatched pair would PATCH some other
    // repo's issue number.
    const res = await POST(postReq({
      linkId: 'link-1',
      remoteId: 'someone-else/their-repo#7',
      title: 'x',
      body: 'y',
    }))

    expect(res.status).toBe(400)
    expect(githubRequest).not.toHaveBeenCalled()
  })
})
