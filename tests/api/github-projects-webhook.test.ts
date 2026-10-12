/**
 * AWTD-1152 (P4d): projects_v2_item webhooks enqueue a hydrate job and drain
 * after the response (spec §8.7); the cron drains whatever that missed.
 *
 *   - the payload is a trigger: only ids are read from it;
 *   - with the capability off (Astrid), nothing is enqueued and the cron 404s;
 *   - an unbound project's edits are not ours;
 *   - a redelivered webhook (same X-GitHub-Delivery) enqueues nothing;
 *   - the App webhook route answers a GitHub-Projects deployment even with the
 *     coding agent off — that brand needs installation and project events.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const caps = vi.hoisted(() => ({ githubProjects: true, codingAgent: true }))
vi.mock('@/lib/brand/capabilities', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/brand/capabilities')>()
  const has = (key: string) => (key in caps ? caps[key as keyof typeof caps] : true)
  return {
    ...actual,
    hasCapability: has,
    capabilityGate: (key: string) => (has(key) ? null : new Response(JSON.stringify({ error: 'Not found' }), { status: 404 })),
  }
})

const projects = vi.hoisted(() => ({ boardsForProjectNodes: vi.fn() }))
vi.mock('@/services/github-projects.service', () => projects)

const queue = vi.hoisted(() => ({ enqueueAccessRefresh: vi.fn(async () => true), enqueueHydrate: vi.fn(async () => true), drainSyncJobs: vi.fn(async () => ({ claimed: 0, succeeded: 0, failed: 0 })) }))
vi.mock('@/services/github-sync-jobs.service', () => queue)

const lifecycle = vi.hoisted(() => ({ deleteRemoteTask: vi.fn(async () => true) }))
vi.mock('@/services/github-projects-lifecycle.service', () => lifecycle)

const deferred = vi.hoisted(() => ({ jobs: [] as Array<() => Promise<unknown>> }))
vi.mock('@/lib/background', () => ({ runAfterResponse: (_l: string, work: () => Promise<unknown>) => deferred.jobs.push(work) }))

const delivery = vi.hoisted(() => ({ first: true }))
vi.mock('@/lib/github/webhooks/issues', () => ({ firstDelivery: vi.fn(async () => delivery.first) }))

import {
  handleIssueDeletedForProjects,
  handleOrgAccessWebhook,
  handleProjectsV2ItemWebhook,
} from '@/lib/github/webhooks/projects'

const payload = {
  action: 'edited',
  installation: { id: 169651419 },
  projects_v2_item: { node_id: 'PVTI_lADOFEb-HM4BmXS2zg_2m1A', project_node_id: 'PVT_kwDOFEb-HM4BmXS2', content_type: 'Issue' },
  changes: { field_value: { field_type: 'single_select' } },
}

beforeEach(() => {
  vi.clearAllMocks()
  caps.githubProjects = true
  caps.codingAgent = true
  delivery.first = true
  deferred.jobs = []
  projects.boardsForProjectNodes.mockResolvedValue(new Map([['PVT_kwDOFEb-HM4BmXS2', 'board-1']]))
})

describe('handleProjectsV2ItemWebhook (AWTD-1152)', () => {
  it('enqueues a hydrate for the item, from its ids alone, and drains after responding', async () => {
    expect(await handleProjectsV2ItemWebhook(payload, 'delivery-1')).toBe(true)

    expect(queue.enqueueHydrate).toHaveBeenCalledWith({
      installationId: 169651419,
      itemNodeId: 'PVTI_lADOFEb-HM4BmXS2zg_2m1A',
      projectNodeId: 'PVT_kwDOFEb-HM4BmXS2',
    })
    expect(queue.drainSyncJobs).not.toHaveBeenCalled()
    await deferred.jobs[0]()
    expect(queue.drainSyncJobs).toHaveBeenCalled()
  })

  it('does nothing with the capability off (Astrid)', async () => {
    caps.githubProjects = false
    expect(await handleProjectsV2ItemWebhook(payload, 'd')).toBe(false)
    expect(projects.boardsForProjectNodes).not.toHaveBeenCalled()
    expect(queue.enqueueHydrate).not.toHaveBeenCalled()
  })

  it("ignores a project nobody bound — every org project's edits arrive here", async () => {
    projects.boardsForProjectNodes.mockResolvedValue(new Map())
    expect(await handleProjectsV2ItemWebhook(payload, 'd')).toBe(false)
    expect(queue.enqueueHydrate).not.toHaveBeenCalled()
  })

  it('ignores a redelivery of the same X-GitHub-Delivery', async () => {
    delivery.first = false
    expect(await handleProjectsV2ItemWebhook(payload, 'delivery-1')).toBe(false)
    expect(queue.enqueueHydrate).not.toHaveBeenCalled()
  })

  it('ignores a payload missing an id it needs', async () => {
    expect(await handleProjectsV2ItemWebhook({ ...payload, installation: undefined }, 'd')).toBe(false)
    expect(await handleProjectsV2ItemWebhook({ ...payload, projects_v2_item: { node_id: 'x' } }, 'd')).toBe(false)
  })
})

describe('the drain cron (AWTD-1152)', () => {
  it('404s without GitHub Projects, and never drains', async () => {
    caps.githubProjects = false
    vi.resetModules()
    const { GET } = await import('@/app/api/cron/github-projects-sync/route')
    expect((await GET(new Request('https://x.example/api/cron/github-projects-sync') as never)).status).toBe(404)
    expect(queue.drainSyncJobs).not.toHaveBeenCalled()
  })

  it('refuses a caller without the cron secret', async () => {
    vi.resetModules()
    const { GET } = await import('@/app/api/cron/github-projects-sync/route')
    expect((await GET(new Request('https://x.example/api/cron/github-projects-sync') as never)).status).toBe(401)
    expect(queue.drainSyncJobs).not.toHaveBeenCalled()
  })
})

describe('the App webhook route answers a GitHub Projects deployment (AWTD-1152)', () => {
  it('is not a 404 with the coding agent off when GitHub Projects is on', async () => {
    caps.codingAgent = false
    caps.githubProjects = true
    vi.resetModules()
    const { POST } = await import('@/app/api/github/webhooks/route')
    const res = await POST(new Request('https://x.example/api/github/webhooks', { method: 'POST', body: '{}' }) as never)
    expect(res.status).not.toBe(404)
  })

  it('is still a 404 with both off', async () => {
    caps.codingAgent = false
    caps.githubProjects = false
    vi.resetModules()
    const { POST } = await import('@/app/api/github/webhooks/route')
    const res = await POST(new Request('https://x.example/api/github/webhooks', { method: 'POST', body: '{}' }) as never)
    expect(res.status).toBe(404)
  })
})

describe('org access and issue deletion (AWTD-1153)', () => {
  it('a member/membership/organization event refreshes the installation’s roles', async () => {
    expect(await handleOrgAccessWebhook({ installation: { id: 7 } }, 'd1')).toBe(true)
    expect(queue.enqueueAccessRefresh).toHaveBeenCalledWith(7)
    expect(deferred.jobs).toHaveLength(1)
  })

  it('…and does nothing on Astrid', async () => {
    caps.githubProjects = false
    expect(await handleOrgAccessWebhook({ installation: { id: 7 } }, 'd1')).toBe(false)
    expect(queue.enqueueAccessRefresh).not.toHaveBeenCalled()
  })

  it('issues.deleted deletes the mirrored task; other actions do not', async () => {
    expect(await handleIssueDeletedForProjects({ action: 'deleted', issue: { node_id: 'I_kw' } })).toBe(true)
    expect(lifecycle.deleteRemoteTask).toHaveBeenCalledWith('I_kw', 'system')
    lifecycle.deleteRemoteTask.mockClear()
    expect(await handleIssueDeletedForProjects({ action: 'closed', issue: { node_id: 'I_kw' } })).toBe(false)
    expect(lifecycle.deleteRemoteTask).not.toHaveBeenCalled()
  })

  it('issue deletion is ignored on Astrid', async () => {
    caps.githubProjects = false
    expect(await handleIssueDeletedForProjects({ action: 'deleted', issue: { node_id: 'I_kw' } })).toBe(false)
  })
})
