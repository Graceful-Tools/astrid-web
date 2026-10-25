/**
 * AWTD-1153 (P4e): roles from GitHub's own answer (spec §8.6), and the hourly
 * redelivery of failed webhook deliveries (§8.7).
 */

import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fetchViewerRole, roleFromViewer } from '@/lib/github/projects/roles'
import { failedDeliveries, redeliverFailedDeliveries, type HookDelivery } from '@/lib/github/redeliver'
import { createBudget, createGraphqlClient, memoryBudgetStore } from '@/lib/github/rate-limiter'

const load = (name: string) =>
  JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/github/graphql', name), 'utf8'))

const replaying = (body: unknown) =>
  createGraphqlClient({
    token: 'ghu',
    bucket: 'user:u',
    priority: 'hydrate',
    budget: createBudget(memoryBudgetStore()),
    fetch: vi.fn(async () => new Response(JSON.stringify(body))) as never,
  })

describe('roleFromViewer (AWTD-1153)', () => {
  it.each([
    [{ viewerCanUpdate: true, viewerCanClose: true }, 'admin'],
    [{ viewerCanUpdate: true, viewerCanClose: false }, 'member'],
    [{ viewerCanUpdate: false, viewerCanClose: false }, 'viewer'],
    [null, null],
  ] as const)('%j → %s', (viewer, role) => {
    expect(roleFromViewer(viewer)).toBe(role)
  })

  it('reads the recorded permissions and who the viewer is (as the App: admin, a bot id)', async () => {
    expect(await fetchViewerRole(replaying(load('viewer-permissions.json')), 'PVT_kwDOFEb-HM4BmXS2')).toEqual({
      role: 'admin',
      identity: { nodeId: 'BOT_kgDODepURQ', databaseId: 233460805 },
    })
  })

  it('a project the user cannot see is no role at all', async () => {
    const hidden = { data: { node: null, rateLimit: { cost: 1, remaining: 1, resetAt: '2026-10-10T15:00:00Z' } } }
    expect((await fetchViewerRole(replaying(hidden), 'PVT_x')).role).toBeNull()
  })
})

describe('redeliverFailedDeliveries (AWTD-1153)', () => {
  const NOW = Date.parse('2026-10-10T12:00:00Z')
  const delivery = (over: Partial<HookDelivery>): HookDelivery => ({
    id: 1,
    guid: 'g1',
    status_code: 500,
    redelivery: false,
    delivered_at: '2026-10-10T11:30:00Z',
    event: 'projects_v2_item',
    ...over,
  })

  it('picks failures from the last two hours that are not themselves redeliveries', () => {
    const all = [
      delivery({ id: 1, guid: 'fail' }),
      delivery({ id: 2, guid: 'timeout', status_code: 0 }),
      delivery({ id: 3, guid: 'ok', status_code: 202 }),
      delivery({ id: 4, guid: 'retry', redelivery: true }),
      delivery({ id: 5, guid: 'old', delivered_at: '2026-10-10T09:00:00Z' }),
    ]
    expect(failedDeliveries(all, NOW).map(d => d.guid)).toEqual(['fail', 'timeout'])
  })

  it('redelivers each failure exactly once across runs', async () => {
    const request = vi.fn(async (route: string) =>
      route.startsWith('GET') ? { data: [delivery({ id: 7, guid: 'once' })] } : { data: {} },
    )
    const claimed = new Set<string>()
    const claim = vi.fn(async (key: string) => (claimed.has(key) ? false : (claimed.add(key), true)))

    expect(await redeliverFailedDeliveries({ request, claim, now: NOW })).toEqual({ redelivered: 1 })
    expect(await redeliverFailedDeliveries({ request, claim, now: NOW })).toEqual({ redelivered: 0 })
    expect(request).toHaveBeenCalledWith('POST /app/hook/deliveries/{delivery_id}/attempts', { delivery_id: 7 })
    expect(request.mock.calls.filter(([route]) => route.startsWith('POST'))).toHaveLength(1)
  })
})
