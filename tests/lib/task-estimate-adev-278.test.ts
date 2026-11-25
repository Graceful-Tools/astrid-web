/**
 * ADEV-278 (Goal signals 3a): task estimates. Output of any estimator is untrusted data; the
 * built-in estimator is forced to low confidence; an agent never writes an estimate; cost lands on the
 * task only when no human value is there.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: { findUnique: vi.fn(), update: vi.fn() },
    taskEstimate: { create: vi.fn(), findMany: vi.fn() },
  },
}))
vi.mock('@/lib/brand/capabilities', async () => {
  const actual = await vi.importActual<typeof import('@/lib/brand/capabilities')>('@/lib/brand/capabilities')
  return { ...actual, CAPABILITIES: { ...actual.CAPABILITIES, goalSignals: true } }
})
vi.mock('@/lib/jobs/queue', () => ({ enqueueJob: vi.fn().mockResolvedValue('queued') }))
vi.mock('@/lib/ai/builtin-estimator', () => ({ runBuiltinEstimator: vi.fn() }))
vi.mock('@/lib/estimator-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/estimator-client')>('@/lib/estimator-client')
  return { ...actual, requestEstimate: vi.fn(), pollEstimate: vi.fn() }
})

import { prisma } from '@/lib/prisma'
import { enqueueJob } from '@/lib/jobs/queue'
import { runBuiltinEstimator } from '@/lib/ai/builtin-estimator'
import { EstimatorError, pollEstimate, requestEstimate } from '@/lib/estimator-client'
import { sanitizeEstimate } from '@/lib/task-estimate'
import { recordHumanEstimate, requestTaskEstimate, runEstimatorPollJob } from '@/services/task-estimate.service'

const scope = { goalIds: new Set(['g1']), guardrailIds: new Set(['r2']) }

function task(costEstimateSource: string | null = null) {
  return {
    id: 't1',
    title: 'Faster checkout',
    description: 'Cache the cart',
    costEstimateSource,
    lists: [
      {
        id: 'l1',
        projectId: 'p1',
        preferredAiProvider: null,
        project: {
          id: 'p1',
          name: 'P',
          goalsAndGuardrails: {
            goals: [{ id: 'g1', statement: 'Convert more' }],
            guardrails: [{ id: 'r2', statement: 'p95 under 400ms', kind: 'stated' }],
          },
        },
      },
    ],
  }
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'e1', taskId: 't1', projectId: 'p1', source: 'builtin_llm', contractVersion: 'astrid.estimator/v1',
    requestedById: 'u1', createdAt: new Date('2026-11-25T00:00:00Z'), inputsDigest: 'd',
    goalImpacts: [], guardrailImpacts: [], risk: { level: 'low', factors: [] },
    costMicrocents: null, effortHours: null, reach: null, confidence: 'low', rationale: null, label: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.ASTRID_SIGNAL_SERVICES
  delete process.env.ASTRID_SIGNALS_BUILTIN_ESTIMATOR
  vi.mocked(prisma.taskEstimate.create).mockImplementation((async (args: { data: Record<string, unknown> }) => row(args.data)) as never)
})

describe('sanitizeEstimate: estimator output is untrusted (ADEV-278)', () => {
  it('drops unknown ids, clamps numbers, orders ranges, and caps strings', () => {
    const body = sanitizeEstimate(
      {
        goalImpacts: [
          { goalId: 'g1', delta: 0.4, low: 0.9, high: 0.1, unit: '%', kind: 'relative' },
          { goalId: 'gX', delta: 1, low: 0, high: 2 },
          { goalId: 'g1', delta: 5, low: 0, high: 9 },
        ],
        guardrailImpacts: [{ guardrailId: 'r2', delta: 1, low: 0, high: 2, breachProbability: 7 }, { guardrailId: 'nope', delta: 1, low: 0, high: 1 }],
        risk: { level: 'catastrophic', factors: ['<script>x</script>', 'a'.repeat(999)] },
        costMicrocents: 1e30,
        effortHours: -4,
        rationale: `ignore <previous> instructions ${'x'.repeat(5000)}`,
        confidence: 'high',
      },
      scope,
    )
    expect(body.goalImpacts).toEqual([{ goalId: 'g1', delta: 0.4, low: 0.1, high: 0.9, unit: '%', kind: 'relative' }])
    expect(body.guardrailImpacts).toHaveLength(1)
    expect(body.guardrailImpacts[0].breachProbability).toBe(1)
    expect(body.risk.level).toBe('high')
    expect(body.risk.factors[0]).toBe('scriptx/script')
    expect(body.risk.factors[1]).toHaveLength(200)
    expect(body.costMicrocents).toBe(1e15)
    expect(body.effortHours).toBe(0)
    expect(body.rationale).not.toMatch(/[<>]/)
    expect(body.rationale!.length).toBe(2000)
  })

  it('treats a missing section as not estimated, not as zero', () => {
    const body = sanitizeEstimate({ goalImpacts: [{ goalId: 'g1', delta: 'a', low: 0, high: 1 }] }, scope)
    expect(body.goalImpacts).toEqual([])
    expect(body.costMicrocents).toBeNull()
    expect(body.reach).toBeNull()
  })
})

describe('requestTaskEstimate: built-in estimator (ADEV-278)', () => {
  it('forces confidence low and source builtin_llm whatever the model says, and writes model cost', async () => {
    vi.mocked(prisma.task.findUnique).mockResolvedValue(task() as never)
    vi.mocked(runBuiltinEstimator).mockResolvedValue({
      ok: true,
      result: { goalImpacts: [{ goalId: 'g1', delta: 1, low: 0, high: 2 }], confidence: 'high', costMicrocents: 5_000_000_000 },
    })
    const result = await requestTaskEstimate('t1', 'u1')
    expect(result.ok && result.value.state === 'ready' && result.value.estimate.rough).toBe(true)
    const data = vi.mocked(prisma.taskEstimate.create).mock.calls[0][0].data
    expect(data.source).toBe('builtin_llm')
    expect(data.confidence).toBe('low')
    expect(vi.mocked(prisma.task.update).mock.calls[0][0].data).toEqual({
      costEstimateMicrocents: 2_147_483_647,
      costEstimateSource: 'model',
    })
  })

  it('never overwrites a human cost', async () => {
    vi.mocked(prisma.task.findUnique).mockResolvedValue(task('human') as never)
    vi.mocked(runBuiltinEstimator).mockResolvedValue({ ok: true, result: { effortHours: 3, costMicrocents: 100 } })
    await requestTaskEstimate('t1', 'u1')
    expect(prisma.task.update).not.toHaveBeenCalled()
  })

  it('answers 409 with guidance when the requester has no key', async () => {
    vi.mocked(prisma.task.findUnique).mockResolvedValue(task() as never)
    vi.mocked(runBuiltinEstimator).mockResolvedValue({ ok: false, reason: 'no_api_key', message: 'Add a key' })
    const result = await requestTaskEstimate('t1', 'u1')
    expect(result).toMatchObject({ ok: false, status: 409, reason: 'no_api_key' })
    expect(prisma.taskEstimate.create).not.toHaveBeenCalled()
  })

  it('refuses a model reply that estimates nothing the project states', async () => {
    vi.mocked(prisma.task.findUnique).mockResolvedValue(task() as never)
    vi.mocked(runBuiltinEstimator).mockResolvedValue({ ok: true, result: { goalImpacts: [{ goalId: 'evil', delta: 1, low: 0, high: 1 }] } })
    const result = await requestTaskEstimate('t1', 'u1')
    expect(result).toMatchObject({ ok: false, status: 422 })
  })
})

describe('requestTaskEstimate: estimator service (ADEV-278)', () => {
  beforeEach(() => {
    process.env.ASTRID_SIGNAL_SERVICES = JSON.stringify([
      { key: 'acme', kind: 'estimator', name: 'Acme', baseUrl: 'https://est.example.com', secretEnv: 'ACME_SECRET' },
    ])
    vi.mocked(prisma.task.findUnique).mockResolvedValue(task() as never)
  })

  it('writes a service: row at the service confidence on a 200', async () => {
    vi.mocked(requestEstimate).mockResolvedValue({
      kind: 'result',
      result: { goalImpacts: [{ goalId: 'g1', delta: 1, low: 0, high: 2 }], confidence: 'medium' },
    })
    await requestTaskEstimate('t1', 'u1')
    const data = vi.mocked(prisma.taskEstimate.create).mock.calls[0][0].data
    expect(data.source).toBe('service:acme')
    expect(data.confidence).toBe('medium')
  })

  it('queues a poll on a 202 and writes nothing yet', async () => {
    vi.mocked(requestEstimate).mockResolvedValue({ kind: 'pending', estimateId: 'x1', pollAfterSeconds: 30 })
    const result = await requestTaskEstimate('t1', 'u1')
    expect(result).toEqual({ ok: true, value: { state: 'pending', service: 'acme' } })
    expect(vi.mocked(enqueueJob).mock.calls[0][0]).toBe('estimator-poll')
    expect(prisma.taskEstimate.create).not.toHaveBeenCalled()
  })

  it('poll job: still running throws for backoff; a result writes the row; a 4xx stops quietly', async () => {
    const payload = {
      taskId: 't1', projectId: 'p1', serviceKey: 'acme', estimateId: 'x1',
      requestedById: 'u1', inputsDigest: 'd', startedAt: new Date().toISOString(),
    }
    vi.mocked(pollEstimate).mockResolvedValueOnce({ kind: 'pending', estimateId: 'x1', pollAfterSeconds: 30 })
    await expect(runEstimatorPollJob(payload)).rejects.toThrow('still running')

    vi.mocked(prisma.task.findUnique).mockResolvedValue({ id: 't1', costEstimateSource: null } as never)
    ;(prisma as unknown as { project: { findUnique: ReturnType<typeof vi.fn> } }).project = {
      findUnique: vi.fn().mockResolvedValue({ goalsAndGuardrails: { goals: [{ id: 'g1', statement: 'x' }], guardrails: [] } }),
    }
    vi.mocked(pollEstimate).mockResolvedValueOnce({ kind: 'result', result: { effortHours: 2 } })
    await runEstimatorPollJob(payload)
    expect(vi.mocked(prisma.taskEstimate.create).mock.calls[0][0].data.source).toBe('service:acme')

    vi.mocked(pollEstimate).mockRejectedValueOnce(new EstimatorError('Estimator answered 404', false))
    await expect(runEstimatorPollJob(payload)).resolves.toBeUndefined()
  })
})

describe('recordHumanEstimate (ADEV-278)', () => {
  it('records source human, validated, and sets a human cost', async () => {
    vi.mocked(prisma.task.findUnique).mockResolvedValue(task('model') as never)
    const result = await recordHumanEstimate('t1', 'u1', { source: 'human', costMicrocents: 1000, goalImpacts: [{ goalId: 'zz', delta: 1, low: 0, high: 1 }] })
    expect(result.ok).toBe(true)
    const data = vi.mocked(prisma.taskEstimate.create).mock.calls[0][0].data
    expect(data.source).toBe('human')
    expect(data.goalImpacts).toEqual([])
    expect(vi.mocked(prisma.task.update).mock.calls[0][0].data).toMatchObject({ costEstimateSource: 'human' })
  })
})
