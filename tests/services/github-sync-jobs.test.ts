/**
 * AWTD-1152 (P4d): the GitHub sync job queue (spec §8.1, §8.7).
 *
 *   - enqueue is one idempotent insert on the coalescing key;
 *   - a drain claims each job with a conditional update, so two drainers never
 *     run one job; a lost claim is skipped;
 *   - a hydrate job re-reads GitHub and applies it to the bound board; an item
 *     GitHub no longer has leaves the board;
 *   - failures back off (or wait out a rate limit); after MAX_ATTEMPTS a job
 *     is dead, its error kept;
 *   - two installations are served fairly within one drain.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const db = vi.hoisted(() => ({
  gitHubSyncJob: { createMany: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const projects = vi.hoisted(() => ({
  boardForProjectNode: vi.fn(),
  applyProjectItems: vi.fn(async () => ({})),
  removeProjectItem: vi.fn(async () => true),
}))
vi.mock('@/services/github-projects.service', () => projects)
vi.mock('@/lib/github/graphql-clients', () => ({ installationGraphqlClient: vi.fn() }))

import { drainSyncJobs, enqueueHydrate } from '@/services/github-sync-jobs.service'
import { MAX_ATTEMPTS } from '@/lib/github/projects/jobs'
import { createBudget, createGraphqlClient, memoryBudgetStore } from '@/lib/github/rate-limiter'

const DIR = join(process.cwd(), 'tests/fixtures/github/graphql')
const load = (name: string) => JSON.parse(readFileSync(join(DIR, name), 'utf8'))
const NOW = new Date('2026-10-10T12:00:00.000Z')
const board = { projectId: 'proj-1', listId: 'list-1', ownerId: 'u', binding: load('binding-graceful-fools.json') }

const replaying = (body: unknown) =>
  createGraphqlClient({
    token: 't',
    bucket: 'installation:1',
    priority: 'hydrate',
    budget: createBudget(memoryBudgetStore()),
    fetch: vi.fn(async () => new Response(JSON.stringify(body))) as never,
  })

const job = (id: string, installationId: number, attempts = 0) => ({
  id,
  kind: 'hydrate',
  installationId,
  attempts,
  payload: { itemNodeId: 'PVTI_lADOFEb-HM4BmXS2zg_2m3Y', projectNodeId: 'PVT_kwDOFEb-HM4BmXS2' },
})

beforeEach(() => {
  vi.clearAllMocks()
  db.gitHubSyncJob.updateMany.mockResolvedValue({ count: 1 })
  projects.boardForProjectNode.mockResolvedValue(board)
})

describe('enqueueHydrate (AWTD-1152)', () => {
  it('is one insert that ignores a duplicate coalescing key', async () => {
    db.gitHubSyncJob.createMany.mockResolvedValue({ count: 1 })
    expect(
      await enqueueHydrate({ installationId: 7, itemNodeId: 'PVTI_x', projectNodeId: 'PVT_y', now: NOW.getTime() }),
    ).toBe(true)
    expect(db.gitHubSyncJob.createMany).toHaveBeenCalledWith({
      data: [
        {
          kind: 'hydrate',
          installationId: 7,
          dedupeKey: `item:PVTI_x:${Math.floor(NOW.getTime() / 2000)}`,
          payload: { itemNodeId: 'PVTI_x', projectNodeId: 'PVT_y' },
        },
      ],
      skipDuplicates: true,
    })
  })

  it('a coalesced duplicate reports false', async () => {
    db.gitHubSyncJob.createMany.mockResolvedValue({ count: 0 })
    expect(await enqueueHydrate({ installationId: 7, itemNodeId: 'PVTI_x', projectNodeId: 'PVT_y' })).toBe(false)
  })
})

describe('drainSyncJobs (AWTD-1152)', () => {
  it('hydrates the item and applies it to the bound board, then marks the job done', async () => {
    db.gitHubSyncJob.findMany.mockResolvedValue([job('j1', 1)])
    const summary = await drainSyncJobs(20, { now: () => NOW, clientFor: () => replaying(load('hydrate-item-draft.json')) })

    expect(summary).toEqual({ claimed: 1, succeeded: 1, failed: 0 })
    expect(projects.applyProjectItems).toHaveBeenCalledWith(board, [
      expect.objectContaining({ id: 'PVTI_lADOFEb-HM4BmXS2zg_2m3Y' }),
    ])
    expect(db.gitHubSyncJob.update).toHaveBeenCalledWith({
      where: { id: 'j1' },
      data: { doneAt: expect.any(Date), lockedUntil: null, error: null },
    })
  })

  it('claims with a conditional update, and skips a job another drainer took', async () => {
    db.gitHubSyncJob.findMany.mockResolvedValue([job('j1', 1)])
    db.gitHubSyncJob.updateMany.mockResolvedValue({ count: 0 })

    expect(await drainSyncJobs(20, { now: () => NOW, clientFor: () => replaying({}) })).toEqual({
      claimed: 0,
      succeeded: 0,
      failed: 0,
    })
    expect(db.gitHubSyncJob.updateMany.mock.calls[0][0].where).toMatchObject({ id: 'j1', doneAt: null })
    expect(projects.applyProjectItems).not.toHaveBeenCalled()
  })

  it('an item GitHub no longer has leaves the board', async () => {
    db.gitHubSyncJob.findMany.mockResolvedValue([job('j1', 1)])
    await drainSyncJobs(20, { now: () => NOW, clientFor: () => replaying(load('hydrate-item-missing.json')) })

    expect(projects.removeProjectItem).toHaveBeenCalledWith(board, 'PVTI_lADOFEb-HM4BmXS2zg_2m3Y')
    expect(projects.applyProjectItems).not.toHaveBeenCalled()
  })

  it('a project no longer bound is done, with nothing to mirror', async () => {
    db.gitHubSyncJob.findMany.mockResolvedValue([job('j1', 1)])
    projects.boardForProjectNode.mockResolvedValue(null)
    const clientFor = vi.fn()

    expect(await drainSyncJobs(20, { now: () => NOW, clientFor })).toMatchObject({ succeeded: 1 })
    expect(projects.applyProjectItems).not.toHaveBeenCalled()
  })

  it('a failure backs off and keeps its error', async () => {
    db.gitHubSyncJob.findMany.mockResolvedValue([job('j1', 1, 2)])
    const before = Date.now()
    await drainSyncJobs(20, {
      now: () => NOW,
      clientFor: () => replaying({ errors: [{ message: 'boom' }] }),
    })

    const data = db.gitHubSyncJob.update.mock.calls[0][0].data
    expect(data).toMatchObject({ lockedUntil: null, error: 'boom' })
    expect(data.doneAt).toBeUndefined()
    // Third attempt: 120s.
    expect(data.runAfter.getTime() - before).toBeGreaterThanOrEqual(119_000)
  })

  it('a rate limit waits until GitHub says, rather than the backoff', async () => {
    db.gitHubSyncJob.findMany.mockResolvedValue([job('j1', 1)])
    await drainSyncJobs(20, {
      now: () => NOW,
      clientFor: () => replaying({ data: null, errors: [{ type: 'RATE_LIMITED', message: 'limit' }] }),
    })
    expect(db.gitHubSyncJob.update.mock.calls[0][0].data.error).toMatch(/budget/)
  })

  it(`after ${MAX_ATTEMPTS} attempts a job is dead: done, with its error`, async () => {
    db.gitHubSyncJob.findMany.mockResolvedValue([job('j1', 1, MAX_ATTEMPTS - 1)])
    await drainSyncJobs(20, { now: () => NOW, clientFor: () => replaying({ errors: [{ message: 'still broken' }] }) })

    expect(db.gitHubSyncJob.update.mock.calls[0][0].data).toMatchObject({ doneAt: expect.any(Date), error: 'still broken' })
  })

  it('serves two installations fairly: one org’s backlog does not starve the other', async () => {
    db.gitHubSyncJob.findMany.mockResolvedValue([
      ...Array.from({ length: 30 }, (_, n) => job(`big-${n}`, 1)),
      job('small-0', 2),
    ])
    const summary = await drainSyncJobs(3, { now: () => NOW, clientFor: () => replaying(load('hydrate-item-draft.json')) })

    const claimedIds = db.gitHubSyncJob.updateMany.mock.calls.map(call => call[0].where.id)
    expect(claimedIds).toEqual(['big-0', 'small-0', 'big-1'])
    expect(summary.claimed).toBe(3)
  })

  it('reads only due, unlocked (or lock-expired), unfinished jobs', async () => {
    db.gitHubSyncJob.findMany.mockResolvedValue([])
    await drainSyncJobs(20, { now: () => NOW })
    expect(db.gitHubSyncJob.findMany.mock.calls[0][0].where).toEqual({
      doneAt: null,
      runAfter: { lte: NOW },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: NOW } }],
    })
  })
})
