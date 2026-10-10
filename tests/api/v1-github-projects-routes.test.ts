/**
 * AWTD-1151 (P4c): the GitHub Projects bind routes (spec §11.2).
 *
 *   - with the capability off (astrid.cc, D5) every route is a 404;
 *   - listing reads with the USER's token, so GitHub decides visibility, and
 *     says which projects are already boards;
 *   - binding needs access to the installation, a project in that org, and a
 *     usable user token; it creates the board and imports after responding;
 *   - only the board owner reads, edits or removes the binding.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mockPrisma } from '../setup'
import { authenticateAPI, requireScopes } from '@/lib/api-auth-middleware'
import { createBudget, createGraphqlClient, memoryBudgetStore } from '@/lib/github/rate-limiter'

vi.mock('@/lib/api-auth-middleware', () => ({ authenticateAPI: vi.fn(), requireScopes: vi.fn() }))

const caps = vi.hoisted(() => ({ githubProjects: true }))
vi.mock('@/lib/brand/capabilities', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/brand/capabilities')>()
  return { ...actual, hasCapability: (key: string) => (key === 'githubProjects' ? caps.githubProjects : true) }
})

const clients = vi.hoisted(() => ({ userGraphqlClient: vi.fn(), installationGraphqlClient: vi.fn(() => 'install-client') }))
vi.mock('@/lib/github/graphql-clients', () => clients)

const service = vi.hoisted(() => ({
  bindGitHubProject: vi.fn(),
  importGitHubProject: vi.fn(async () => ({})),
  updateBindingMapping: vi.fn(),
  unbindGitHubProject: vi.fn(),
  boardsForProjectNodes: vi.fn(async () => new Map()),
  readBinding: vi.fn(async () => null),
}))
vi.mock('@/services/github-projects.service', () => service)

const deferred = vi.hoisted(() => ({ jobs: [] as Array<() => Promise<unknown>> }))
vi.mock('@/lib/background', () => ({
  runAfterResponse: (_label: string, work: () => Promise<unknown>) => deferred.jobs.push(work),
}))

const DIR = join(process.cwd(), 'tests/fixtures/github/graphql')
const load = (name: string) => JSON.parse(readFileSync(join(DIR, name), 'utf8'))
const replaying = (...bodies: unknown[]) => {
  const queue = [...bodies]
  return createGraphqlClient({
    token: 'ghu_user',
    bucket: 'user:user-1',
    priority: 'write',
    budget: createBudget(memoryBudgetStore()),
    fetch: vi.fn(async () => new Response(JSON.stringify(queue.shift()))) as never,
  })
}

const PROJECT = 'PVT_kwDOFEb-HM4BmXS2'
const access = (id: number, accountLogin: string, extra: Record<string, unknown> = {}) => ({
  installation: {
    id,
    accountLogin,
    accountType: 'Organization',
    repositorySelection: 'all',
    suspendedAt: null,
    _count: { repos: 1 },
    ...extra,
  },
})


async function routes() {
  vi.resetModules()
  const list = await import('@/app/api/v1/github/projects/route')
  const bind = await import('@/app/api/v1/github/projects/[id]/bind/route')
  const binding = await import('@/app/api/v1/github/projects/[id]/binding/route')
  return { list, bind, binding }
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const json = (method: string, body?: unknown) =>
  new Request('https://x.example/api', { method, body: body === undefined ? undefined : JSON.stringify(body) }) as never

beforeEach(() => {
  vi.clearAllMocks()
  caps.githubProjects = true
  deferred.jobs = []
  vi.mocked(authenticateAPI).mockResolvedValue({ userId: 'user-1', source: 'session', scopes: ['*'] } as never)
  vi.mocked(requireScopes).mockImplementation(() => {})
  mockPrisma.gitHubInstallationAccess.findMany.mockResolvedValue([access(169651419, 'Graceful-Fools')])
  service.boardsForProjectNodes.mockResolvedValue(new Map())
  service.readBinding.mockResolvedValue(null)
  mockPrisma.project.findUnique.mockResolvedValue({ ownerId: 'user-1' })
})

describe('with the capability off — Astrid (D5, AWTD-1151)', () => {
  it('every route answers 404 and never reaches GitHub', async () => {
    caps.githubProjects = false
    const { list, bind, binding } = await routes()

    expect((await list.GET(json('GET'), {} as never)).status).toBe(404)
    expect((await bind.POST(json('POST', { installationId: 1 }), ctx(PROJECT))).status).toBe(404)
    expect((await binding.GET(json('GET'), ctx('proj-1'))).status).toBe(404)
    expect((await binding.PATCH(json('PATCH', {}), ctx('proj-1'))).status).toBe(404)
    expect((await binding.DELETE(json('DELETE'), ctx('proj-1'))).status).toBe(404)
    expect(clients.userGraphqlClient).not.toHaveBeenCalled()
  })
})

describe('GET /api/v1/github/projects (AWTD-1151)', () => {
  it("lists each org's projects as the user sees them, marking bound ones", async () => {
    clients.userGraphqlClient.mockResolvedValue(replaying(load('org-projects.json')))
    service.boardsForProjectNodes.mockResolvedValue(new Map([[PROJECT, 'board-1']]))
    const { list } = await routes()

    const res = await list.GET(json('GET'), {} as never)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(clients.userGraphqlClient).toHaveBeenCalledWith('user-1', 'write')
    expect(body.installations[0]).toMatchObject({ installationId: 169651419, accountLogin: 'Graceful-Fools' })
    expect(body.installations[0].projects[0]).toMatchObject({
      nodeId: PROJECT,
      title: 'Graceful-Tools Test',
      itemCount: 3,
      boundProjectId: 'board-1',
    })
  })

  it('a personal-account installation offers no projects (user projects are out of v1, §8.1)', async () => {
    mockPrisma.gitHubInstallationAccess.findMany.mockResolvedValue([access(2, 'someone', { accountType: 'User' })])
    const { list } = await routes()

    expect(await (await list.GET(json('GET'), {} as never)).json()).toEqual({ installations: [] })
    expect(clients.userGraphqlClient).not.toHaveBeenCalled()
  })

  it('no usable user token → auth_required (a 403, so the client does not sign out)', async () => {
    clients.userGraphqlClient.mockResolvedValue(null)
    const { list } = await routes()

    const res = await list.GET(json('GET'), {} as never)
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('auth_required')
  })
})

describe('POST /api/v1/github/projects/{nodeId}/bind (AWTD-1151)', () => {
  it('binds with the proposed mapping and imports after responding, on the installation token', async () => {
    clients.userGraphqlClient.mockResolvedValue(replaying(load('project-schema.json')))
    service.bindGitHubProject.mockResolvedValue({ ok: true, projectId: 'board-1', listId: 'list-1' })
    const { bind } = await routes()

    const res = await bind.POST(json('POST', { installationId: 169651419 }), ctx(PROJECT))
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body).toMatchObject({ projectId: 'board-1', listId: 'list-1', importing: true })
    expect(body.mapping.statusOptionMap).toEqual({ f75ad846: 'ready', '47fc9ee4': 'doing', '98236657': 'done' })
    expect(service.bindGitHubProject.mock.calls[0][0]).toMatchObject({ userId: 'user-1', installationId: 169651419 })

    expect(service.importGitHubProject).not.toHaveBeenCalled()
    await deferred.jobs[0]()
    expect(clients.installationGraphqlClient).toHaveBeenCalledWith(169651419, 'hydrate')
    expect(service.importGitHubProject).toHaveBeenCalledWith('board-1', 'install-client')
  })

  it('a mapping override wins over the proposal, field by field', async () => {
    clients.userGraphqlClient.mockResolvedValue(replaying(load('project-schema.json')))
    service.bindGitHubProject.mockResolvedValue({ ok: true, projectId: 'b', listId: 'l' })
    const { bind } = await routes()

    await bind.POST(json('POST', { installationId: 169651419, mapping: { dueFieldId: null } }), ctx(PROJECT))
    expect(service.bindGitHubProject.mock.calls[0][0].proposal).toMatchObject({
      dueFieldId: null,
      estimateFieldId: 'PVTF_lADOFEb-HM4BmXS2zhlAp70',
    })
  })

  it('an installation the user has no access to is forbidden — before GitHub is asked', async () => {
    const { bind } = await routes()
    const res = await bind.POST(json('POST', { installationId: 999 }), ctx(PROJECT))
    expect(res.status).toBe(403)
    expect(clients.userGraphqlClient).not.toHaveBeenCalled()
  })

  it('a project the user cannot see on GitHub is a 404', async () => {
    clients.userGraphqlClient.mockResolvedValue(
      replaying({ data: { node: null, rateLimit: { cost: 1, remaining: 1, resetAt: '2026-10-10T15:00:00Z' } } }),
    )
    const { bind } = await routes()
    expect((await bind.POST(json('POST', { installationId: 169651419 }), ctx(PROJECT))).status).toBe(404)
    expect(service.bindGitHubProject).not.toHaveBeenCalled()
  })

  it("a project from another org can't be bound through this installation", async () => {
    mockPrisma.gitHubInstallationAccess.findMany.mockResolvedValue([access(5, 'acme')])
    clients.userGraphqlClient.mockResolvedValue(replaying(load('project-schema.json')))
    const { bind } = await routes()
    expect((await bind.POST(json('POST', { installationId: 5 }), ctx(PROJECT))).status).toBe(400)
    expect(service.bindGitHubProject).not.toHaveBeenCalled()
  })

  it('already bound → 409 naming the board', async () => {
    clients.userGraphqlClient.mockResolvedValue(replaying(load('project-schema.json')))
    service.bindGitHubProject.mockResolvedValue({ ok: false, status: 409, error: 'already_bound', projectId: 'board-1' })
    const { bind } = await routes()

    const res = await bind.POST(json('POST', { installationId: 169651419 }), ctx(PROJECT))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'already_bound', projectId: 'board-1' })
  })

  it('a GitHub rate limit is a 429 with retryAfter', async () => {
    clients.userGraphqlClient.mockResolvedValue(
      replaying({ data: null, errors: [{ type: 'RATE_LIMITED', message: 'limit' }] }),
    )
    const { bind } = await routes()

    const res = await bind.POST(json('POST', { installationId: 169651419 }), ctx(PROJECT))
    expect(res.status).toBe(429)
    expect((await res.json()).error).toBe('rate_limited')
  })

  it('rejects an unknown mapping field rather than ignoring it', async () => {
    const { bind } = await routes()
    const res = await bind.POST(json('POST', { installationId: 169651419, mapping: { ownerId: 'x' } }), ctx(PROJECT))
    expect(res.status).toBe(400)
  })
})

describe('/api/v1/github/projects/{projectId}/binding (AWTD-1151)', () => {
  it('only the board owner may read, edit or remove it', async () => {
    mockPrisma.project.findUnique.mockResolvedValue({ ownerId: 'someone-else' })
    const { binding } = await routes()

    expect((await binding.GET(json('GET'), ctx('board-1'))).status).toBe(403)
    expect((await binding.PATCH(json('PATCH', { dueFieldId: null }), ctx('board-1'))).status).toBe(403)
    expect((await binding.DELETE(json('DELETE'), ctx('board-1'))).status).toBe(403)
    expect(service.unbindGitHubProject).not.toHaveBeenCalled()
  })

  it('PATCH stores a valid mapping edit; DELETE unbinds', async () => {
    service.readBinding.mockResolvedValue({ projectId: 'board-1' } as never)
    const { binding } = await routes()

    expect((await binding.PATCH(json('PATCH', { priorityOptionMap: { a: 3, b: 0 } }), ctx('board-1'))).status).toBe(200)
    expect(service.updateBindingMapping).toHaveBeenCalledWith('board-1', { priorityOptionMap: { a: 3, b: 0 } })

    expect((await binding.DELETE(json('DELETE'), ctx('board-1'))).status).toBe(200)
    expect(service.unbindGitHubProject).toHaveBeenCalledWith('board-1')
  })

  it('PATCH refuses a priority outside 0..3', async () => {
    service.readBinding.mockResolvedValue({ projectId: 'board-1' } as never)
    const { binding } = await routes()
    expect((await binding.PATCH(json('PATCH', { priorityOptionMap: { a: 7 } }), ctx('board-1'))).status).toBe(400)
  })

  it('a board that is not bound is a 404', async () => {
    const { binding } = await routes()
    expect((await binding.GET(json('GET'), ctx('board-1'))).status).toBe(404)
  })
})
