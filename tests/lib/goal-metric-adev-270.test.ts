/**
 * ADEV-270 (Goal signals 1a): a goal's typed metric block, numeric measurements, preserve-on-omit on
 * the goals PUT, and an idempotent numeric measure PUT.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    project: { findUnique: vi.fn(), update: vi.fn() },
    comment: { findMany: vi.fn().mockResolvedValue([]) },
  },
}))

import { prisma } from '@/lib/prisma'
import { goalProgress, parseGoalsAndGuardrails, withMeasurement } from '@/lib/goals-guardrails'
import { recordGoalMeasurement, setProjectGoals } from '@/services/project-goals.service'

const METRIC = { direction: 'down' as const, unit: 'ms', target: 200, baseline: 400, source: { connectorId: 'c1', metricKey: 'p95' } }

function project(goals: unknown[]) {
  return {
    id: 'p1', name: 'P', ownerId: 'owner', members: [], lists: [],
    goalsAndGuardrails: { goals, guardrails: [] },
  }
}
const stored = () => (vi.mocked(prisma.project.update).mock.calls[0][0].data as { goalsAndGuardrails: { goals: any[] } }).goalsAndGuardrails.goals[0]

beforeEach(() => {
  vi.clearAllMocks()
})

describe('goal metric parsing (ADEV-270)', () => {
  it('keeps a valid metric and refuses a malformed one', () => {
    const ok = parseGoalsAndGuardrails({ goals: [{ statement: 'Fast', metric: METRIC }] })
    expect(ok.ok && ok.value.goals[0].metric).toEqual(METRIC)
    expect(parseGoalsAndGuardrails({ goals: [{ statement: 'Fast', metric: { direction: 'sideways' } }] }).ok).toBe(false)
    expect(parseGoalsAndGuardrails({ goals: [{ statement: 'Fast', metric: { direction: 'up', target: 'ten' } }] }).ok).toBe(false)
  })
})

describe('goalProgress prefers the metric (ADEV-270)', () => {
  it('reads direction down as met at or below target, ignoring the prose', () => {
    expect(goalProgress({ target: '10', current: '50', metric: { direction: 'down', target: 200, current: 150 } })).toEqual({ met: true, percent: null })
  })
  it('reads direction up as a percentage', () => {
    expect(goalProgress({ metric: { direction: 'up', target: 10, current: 5 } })).toEqual({ met: false, percent: 50 })
  })
  it('falls back to the prose when the metric has no numbers yet', () => {
    expect(goalProgress({ target: '10', current: '5', metric: { direction: 'up' } })).toEqual({ met: false, percent: 50 })
  })
})

describe('goals PUT preserves the stored metric on omit (ADEV-270)', () => {
  const withStoredMetric = () =>
    project([{ id: 'g1', statement: 'Fast', metric: { ...METRIC, current: 180, measuredAt: '2026-11-25T10:00:00.000Z' } }])

  it('keeps the metric when the PUT leaves it out', async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue(withStoredMetric() as never)
    const res = await setProjectGoals('p1', 'owner', { goals: [{ id: 'g1', statement: 'Fast, edited' }], guardrails: [] })
    expect(res.ok).toBe(true)
    expect(stored().statement).toBe('Fast, edited')
    expect(stored().metric).toEqual({ ...METRIC, current: 180, measuredAt: '2026-11-25T10:00:00.000Z' })
  })

  it('clears the metric on an explicit null', async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue(withStoredMetric() as never)
    await setProjectGoals('p1', 'owner', { goals: [{ id: 'g1', statement: 'Fast', metric: null }], guardrails: [] })
    expect(stored()).not.toHaveProperty('metric')
  })

  it('does not let a client overwrite the server-written reading', async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue(withStoredMetric() as never)
    await setProjectGoals('p1', 'owner', { goals: [{ id: 'g1', statement: 'Fast', metric: { ...METRIC, target: 150, current: 1 } }], guardrails: [] })
    expect(stored().metric.target).toBe(150)
    expect(stored().metric.current).toBe(180)
  })
})

describe('numeric measure PUT (ADEV-270)', () => {
  const goalsWithMetric = () => project([{ id: 'g1', statement: 'Fast', metric: METRIC }])

  it('records num and source, and moves metric.current', async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue(goalsWithMetric() as never)
    const res = await recordGoalMeasurement('p1', 'owner', 'g1', { value: 180, externalId: 'run-1', at: '2026-11-25T10:00:00Z' }, 'owner', 'human')
    expect(res.ok).toBe(true)
    expect(stored().current).toBe('180 ms')
    expect(stored().metric.current).toBe(180)
    expect(stored().metric.measuredAt).toBe('2026-11-25T10:00:00.000Z')
    expect(stored().history[0]).toMatchObject({ num: 180, source: 'push', externalId: 'run-1' })
  })

  it('treats a repeated externalId as a no-op', async () => {
    const first = withMeasurement({ id: 'g1', statement: 'Fast', metric: METRIC }, '180 ms', 'owner', new Date(), undefined, { num: 180, source: 'push', externalId: 'run-1' })
    vi.mocked(prisma.project.findUnique).mockResolvedValue(project([first]) as never)
    const res = await recordGoalMeasurement('p1', 'owner', 'g1', { value: 170, externalId: 'run-1' }, 'owner', 'human')
    expect(res.ok).toBe(true)
    expect(prisma.project.update).not.toHaveBeenCalled()
  })

  it('still accepts the old { current } form and rejects a non-number value', async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue(goalsWithMetric() as never)
    expect((await recordGoalMeasurement('p1', 'owner', 'g1', { current: '190 ms' }, 'owner', 'agent')).ok).toBe(true)
    expect(stored().history[0].source).toBe('agent')
    const bad = await recordGoalMeasurement('p1', 'owner', 'g1', { value: 'fast' }, 'owner', 'human')
    expect(bad).toMatchObject({ ok: false, status: 400 })
  })
})
