/**
 * ADEV-277: the poll job reads each bound metric once per connector, writes only fresh readings
 * through recordGoalMeasurement (source `pull`), and one connector's failure never stops the rest.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  projectConnector: { findMany: vi.fn(), count: vi.fn(), update: vi.fn() },
  project: { findUnique: vi.fn() },
}))
const recordGoalMeasurement = vi.hoisted(() => vi.fn())
const recordGuardrailReading = vi.hoisted(() => vi.fn())
const canUseGoalSignals = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/goal-signals', () => ({ canUseGoalSignals }))
vi.mock('@/services/project-goals.service', () => ({ recordGoalMeasurement, recordGuardrailReading }))

import { boundKeys, pollGoalMetrics } from '@/lib/goal-signals-poll'

const NOW = new Date('2026-11-25T17:00:00Z')
const connector = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  projectId: `p-${id}`,
  kind: 'metric',
  serviceKey: 'acme',
  name: 'Acme',
  endpointUrl: null,
  credentialEnc: null,
  config: null,
  state: 'ok',
  lastOkAt: null,
  lastError: null,
  lastPolledAt: null,
  createdAt: new Date(),
  ...over,
})
const stated = (connectorId: string) => ({
  goals: [{ id: 'g1', statement: 'Convert', metric: { direction: 'up', unit: '%', source: { connectorId, metricKey: 'conv' } } }],
  guardrails: [
    {
      id: 'r1',
      statement: 'Errors low',
      kind: 'enforced',
      check: { type: 'metric', source: { connectorId, metricKey: 'err' }, op: '<=', threshold: 2 },
    },
  ],
})
const ok = (metrics: unknown[]) => (async () => new Response(JSON.stringify({ metrics }), { status: 200 })) as unknown as typeof fetch

beforeEach(() => {
  vi.resetAllMocks()
  process.env.ASTRID_SIGNAL_SERVICES = JSON.stringify([{ key: 'acme', kind: 'metric', name: 'Acme', baseUrl: 'https://acme.example.com', secretEnv: 'ACME_KEY' }])
  process.env.ACME_KEY = 'k'
  prismaMock.projectConnector.count.mockResolvedValue(1)
  prismaMock.projectConnector.update.mockResolvedValue({})
  canUseGoalSignals.mockResolvedValue(true)
  recordGoalMeasurement.mockResolvedValue({ ok: true })
  recordGuardrailReading.mockResolvedValue(1)
})

describe('boundKeys (ADEV-277)', () => {
  it('collects the keys of goals and enforced metric guardrails bound to the connector, once each', () => {
    const s = stated('c1')
    s.goals.push({ id: 'g2', statement: 'again', metric: { direction: 'up', unit: '%', source: { connectorId: 'c1', metricKey: 'conv' } } })
    s.goals.push({ id: 'g3', statement: 'other', metric: { direction: 'up', unit: '%', source: { connectorId: 'other', metricKey: 'zzz' } } })
    expect(boundKeys(s as never, 'c1').sort()).toEqual(['conv', 'err'])
  })
})

describe('pollGoalMetrics (ADEV-277)', () => {
  it('asks once, writes a fresh goal reading as a pull and updates the guardrail', async () => {
    prismaMock.projectConnector.findMany.mockResolvedValue([connector('c1')])
    prismaMock.project.findUnique.mockResolvedValue({ id: 'p-c1', ownerId: 'owner', goalsAndGuardrails: stated('c1') })
    const summary = await pollGoalMetrics({
      now: () => NOW,
      fetchImpl: ok([
        { key: 'conv', status: 'ok', value: 6.1, unit: '%', at: '2026-11-25T16:00:00Z' },
        { key: 'err', status: 'ok', value: 1.1, at: '2026-11-25T16:30:00Z' },
      ]),
    })
    expect(recordGoalMeasurement).toHaveBeenCalledWith(
      'p-c1',
      'owner',
      'g1',
      { value: 6.1, at: '2026-11-25T16:00:00.000Z', externalId: 'c1:conv:2026-11-25T16:00:00.000Z' },
      'c1',
      'pull',
    )
    expect(recordGuardrailReading).toHaveBeenCalledWith('p-c1', { connectorId: 'c1', metricKey: 'err' }, { value: 1.1, at: new Date('2026-11-25T16:30:00Z') })
    expect(summary).toMatchObject({ connectors: 1, recorded: 1, guardrailsUpdated: 1, failed: 0 })
    expect(prismaMock.projectConnector.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: 'ok' }) }))
  })

  it('does not write a reading already past the goal\'s staleness window', async () => {
    prismaMock.projectConnector.findMany.mockResolvedValue([connector('c1')])
    const s = stated('c1')
    prismaMock.project.findUnique.mockResolvedValue({ id: 'p-c1', ownerId: 'owner', goalsAndGuardrails: s })
    await pollGoalMetrics({ now: () => NOW, fetchImpl: ok([{ key: 'conv', status: 'ok', value: 6.1, at: '2026-11-20T16:00:00Z' }]) })
    expect(recordGoalMeasurement).not.toHaveBeenCalled()
    expect(recordGuardrailReading).not.toHaveBeenCalled()
  })

  it('writes nothing for no_data or unknown_metric', async () => {
    prismaMock.projectConnector.findMany.mockResolvedValue([connector('c1')])
    prismaMock.project.findUnique.mockResolvedValue({ id: 'p-c1', ownerId: 'owner', goalsAndGuardrails: stated('c1') })
    await pollGoalMetrics({ now: () => NOW, fetchImpl: ok([{ key: 'conv', status: 'no_data' }, { key: 'err', status: 'unknown_metric' }]) })
    expect(recordGoalMeasurement).not.toHaveBeenCalled()
    expect(recordGuardrailReading).not.toHaveBeenCalled()
  })

  it('makes no request for a connector nothing is bound to', async () => {
    prismaMock.projectConnector.findMany.mockResolvedValue([connector('c1')])
    prismaMock.project.findUnique.mockResolvedValue({ id: 'p-c1', ownerId: 'owner', goalsAndGuardrails: stated('someone-else') })
    const fetchImpl = vi.fn()
    const summary = await pollGoalMetrics({ now: () => NOW, fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(summary.skipped).toBe(1)
  })

  it('makes no request for a project whose owner lacks Goal Signals', async () => {
    canUseGoalSignals.mockResolvedValue(false)
    prismaMock.projectConnector.findMany.mockResolvedValue([connector('c1')])
    prismaMock.project.findUnique.mockResolvedValue({ id: 'p-c1', ownerId: 'owner', goalsAndGuardrails: stated('c1') })
    const fetchImpl = vi.fn()
    await pollGoalMetrics({ now: () => NOW, fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('records a failure and goes on to the next connector', async () => {
    prismaMock.projectConnector.findMany.mockResolvedValue([connector('c1'), connector('c2')])
    prismaMock.project.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
      const id = where.id.replace('p-', '')
      return { id: where.id, ownerId: 'owner', goalsAndGuardrails: stated(id) }
    })
    let calls = 0
    const fetchImpl = (async () => {
      calls++
      if (calls === 1) return new Response('no', { status: 401 })
      return new Response(JSON.stringify({ metrics: [{ key: 'conv', status: 'ok', value: 7, at: '2026-11-25T16:00:00Z' }] }), { status: 200 })
    }) as unknown as typeof fetch
    const summary = await pollGoalMetrics({ now: () => NOW, fetchImpl })
    expect(summary).toMatchObject({ connectors: 2, failed: 1, recorded: 1 })
    expect(prismaMock.projectConnector.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'c1' }, data: expect.objectContaining({ state: 'error', lastError: expect.stringContaining('401') }) }),
    )
  })

  it('waits out a Retry-After the service asked for', async () => {
    prismaMock.projectConnector.findMany.mockResolvedValue([connector('c1', { config: { retryNotBefore: '2026-11-25T17:30:00.000Z' } })])
    const fetchImpl = vi.fn()
    const summary = await pollGoalMetrics({ now: () => NOW, fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(summary.skipped).toBe(1)
  })

  it('reports when more connectors were waiting than one pass takes', async () => {
    prismaMock.projectConnector.findMany.mockResolvedValue([])
    prismaMock.projectConnector.count.mockResolvedValue(7)
    expect(await pollGoalMetrics({ now: () => NOW })).toMatchObject({ capped: true, remaining: 7 })
  })
})
