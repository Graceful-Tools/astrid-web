// @vitest-environment node
/**
 * ADEV-281 — the trade-off policy is evaluated on the server, on write, and the answer is stored on
 * the estimate row. No policy stated: no label. A policy edit enqueues a bounded re-evaluation of the
 * rows whose digest differs. Every test here asks the real vendored core build; only the database is mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    project: { findUnique: vi.fn(), update: vi.fn() },
    task: { findUnique: vi.fn() },
    taskList: { findUnique: vi.fn(), update: vi.fn() },
    taskEstimate: { update: vi.fn(), findMany: vi.fn() },
  },
}))
vi.mock('@/lib/jobs/queue', () => ({ enqueueJob: vi.fn().mockResolvedValue('queued') }))
vi.mock('@/lib/list-permissions', async () => {
  const actual = await vi.importActual<typeof import('@/lib/list-permissions')>('@/lib/list-permissions')
  return {
    ...actual,
    canUserManageProject: vi.fn().mockReturnValue(true),
    getUserRoleInProject: vi.fn().mockReturnValue('owner'),
  }
})

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { enqueueJob } from '@/lib/jobs/queue'
import { setProjectOrchestrationPolicy } from '@/services/orchestration-policy.service'
import {
  REEVALUATE_PAGE_SIZE,
  evaluateEstimateRow,
  policyDigestOf,
  runTradeoffReevaluationJob,
} from '@/services/tradeoff-evaluation.service'
import { v1TaskEstimate, v1TaskEstimatePatch } from '@/lib/tasks/v1-task-estimate'

const GOALS = {
  goals: [{ id: 'g1', statement: 'Convert more', metric: { direction: 'up' } }],
  guardrails: [{ id: 'r1', statement: 'p95 under 400ms', kind: 'stated' }],
}

const project = (orchestrationPolicy: unknown = null) => ({ id: 'p1', orchestrationPolicy, goalsAndGuardrails: GOALS })

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'e1', taskId: 't1', projectId: 'p1', source: 'service:acme', contractVersion: 'astrid.estimator/v1',
    requestedById: 'u1', createdAt: new Date(), inputsDigest: 'd',
    goalImpacts: [{ goalId: 'g1', delta: 5, low: 2, high: 8, kind: 'absolute' }],
    guardrailImpacts: [{ guardrailId: 'r1', delta: 0, low: 0, high: 0, breachProbability: 0.01 }],
    risk: { level: 'low', factors: [] },
    costMicrocents: null, effortHours: null, reach: null, confidence: 'high', rationale: null,
    label: null, labelReasons: null, sortKey: null, policyDigest: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.task.findUnique).mockResolvedValue({ lists: [{ id: 'l1', projectId: 'p1', orchestrationPolicy: null }] } as never)
  vi.mocked(prisma.taskEstimate.update).mockImplementation((async (args: { data: Record<string, unknown> }) => ({ ...row(), ...args.data })) as never)
})

describe('evaluateEstimateRow (ADEV-281)', () => {
  it('labels an estimate under the project\'s policy and stores label, reasons, key and digest', async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue(project({ tradeoff: { goalOrder: ['g1'] } }) as never)
    const stored = await evaluateEstimateRow(row() as never)

    const data = vi.mocked(prisma.taskEstimate.update).mock.calls[0][0].data as Record<string, unknown>
    expect(data.label).toBe('do-now')
    expect(data.labelReasons).toEqual([{ code: 'goalImproves', goalId: 'g1', delta: 5 }])
    expect(data.sortKey).toEqual(expect.arrayContaining([0]))
    expect((data.sortKey as number[]).every(Number.isSafeInteger)).toBe(true)
    expect(data.policyDigest).toMatch(/^[0-9a-f]{40}$/)
    expect(stored.label).toBe('do-now')
  })

  it('stores no label when no policy is stated, and says so in the digest so a later policy re-labels it', async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue(project(null) as never)
    await evaluateEstimateRow(row() as never)

    const data = vi.mocked(prisma.taskEstimate.update).mock.calls[0][0].data as Record<string, unknown>
    expect(data.label).toBeNull()
    expect(data.labelReasons).toBe(Prisma.DbNull)
    expect(data.sortKey).toBe(Prisma.DbNull)
    const digest = policyDigestOf(null, { guardrailsStated: true, directions: new Map([['g1', 'up' as const]]) })
    expect(data.policyDigest).toBe(digest)
  })

  it('lets a list override one threshold of the project\'s policy', async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue(project({ tradeoff: {} }) as never)
    vi.mocked(prisma.task.findUnique).mockResolvedValue({
      lists: [{ id: 'l1', projectId: 'p1', orchestrationPolicy: { tradeoff: { risk: { reviewAt: 'low' } } } }],
    } as never)
    await evaluateEstimateRow(row() as never)

    const data = vi.mocked(prisma.taskEstimate.update).mock.calls[0][0].data as Record<string, unknown>
    expect(data.label).toBe('needs-review')
    expect(data.labelReasons).toEqual([{ code: 'riskAtReview', level: 'low', threshold: 'low' }])
  })

  it('treats a guardrail impact with no probability as unknown, never a pass', async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue(project({ tradeoff: {} }) as never)
    await evaluateEstimateRow(row({ guardrailImpacts: [{ guardrailId: 'r1', delta: 0, low: 0, high: 0 }] }) as never)

    const data = vi.mocked(prisma.taskEstimate.update).mock.calls[0][0].data as Record<string, unknown>
    expect(data.label).toBe('needs-review')
    expect(data.labelReasons).toEqual([{ code: 'guardrailsUnknown' }])
  })

  it('caps a built-in estimate at experiment-first', async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue(project({ tradeoff: {} }) as never)
    await evaluateEstimateRow(row({ source: 'builtin_llm' }) as never)
    expect(vi.mocked(prisma.taskEstimate.update).mock.calls[0][0].data).toMatchObject({ label: 'experiment-first' })
  })

  it('passes an old estimate as stale, so it needs review', async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue(project({ tradeoff: {} }) as never)
    await evaluateEstimateRow(row({ createdAt: new Date(Date.now() - 45 * 24 * 60 * 60_000) }) as never)
    expect(vi.mocked(prisma.taskEstimate.update).mock.calls[0][0].data).toMatchObject({ label: 'needs-review' })
  })

  it('never throws: a database failure leaves the estimate as written', async () => {
    vi.mocked(prisma.project.findUnique).mockRejectedValue(new Error('db down'))
    const original = row()
    await expect(evaluateEstimateRow(original as never)).resolves.toBe(original)
  })
})

describe('runTradeoffReevaluationJob (ADEV-281)', () => {
  const withTask = (r: ReturnType<typeof row>) => ({ ...r, task: { lists: [{ id: 'l1', projectId: 'p1', orchestrationPolicy: null }] } })

  it('re-labels only the rows whose digest differs', async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue(project({ tradeoff: {} }) as never)
    const current = policyDigestOf(
      { goalOrder: [], risk: { reviewAt: 'medium', refuseAt: 'high' }, guardrail: { reviewAtBreachProbability: 0.1, refuseAtBreachProbability: 0.5 }, experimentFirst: { confidenceBelow: 'medium', riskAtLeast: 'medium' }, minConfidenceToAct: 'medium' },
      { guardrailsStated: true, directions: new Map([['g1', 'up' as const]]) },
    )
    vi.mocked(prisma.taskEstimate.findMany).mockResolvedValue([
      withTask(row({ id: 'fresh', taskId: 'a', policyDigest: current })),
      withTask(row({ id: 'stale', taskId: 'b', policyDigest: 'old' })),
      withTask(row({ id: 'never', taskId: 'c', policyDigest: null })),
    ] as never)

    await runTradeoffReevaluationJob({ projectId: 'p1', listId: null, afterTaskId: null })

    expect(vi.mocked(prisma.taskEstimate.update).mock.calls.map(call => call[0].where)).toEqual([{ id: 'stale' }, { id: 'never' }])
    expect(enqueueJob).not.toHaveBeenCalled()
  })

  it('clears the label of a row when the policy was taken away', async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue(project(null) as never)
    vi.mocked(prisma.taskEstimate.findMany).mockResolvedValue([
      withTask(row({ id: 'e1', taskId: 'a', label: 'do-now', sortKey: [0], policyDigest: 'under-the-old-policy' })),
    ] as never)

    await runTradeoffReevaluationJob({ projectId: 'p1', listId: null, afterTaskId: null })

    expect(vi.mocked(prisma.taskEstimate.update).mock.calls[0][0].data).toMatchObject({ label: null, sortKey: Prisma.DbNull })
  })

  it('queues the next page when a page fills, from where this one stopped, and not otherwise', async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue(project(null) as never)
    const full = Array.from({ length: REEVALUATE_PAGE_SIZE }, (_, i) => withTask(row({ id: `e${i}`, taskId: `t${String(i).padStart(3, '0')}`, policyDigest: 'x' })))
    vi.mocked(prisma.taskEstimate.findMany).mockResolvedValue(full as never)

    await runTradeoffReevaluationJob({ projectId: 'p1', listId: 'l1', afterTaskId: null })

    expect(enqueueJob).toHaveBeenCalledWith('tradeoff-reevaluate', { projectId: 'p1', listId: 'l1', afterTaskId: `t${String(REEVALUATE_PAGE_SIZE - 1).padStart(3, '0')}` })
    const query = vi.mocked(prisma.taskEstimate.findMany).mock.calls[0][0]!
    expect(query.take).toBe(REEVALUATE_PAGE_SIZE)
    expect(query.distinct).toEqual(['taskId'])
    expect(query.where).toMatchObject({ projectId: 'p1', task: { lists: { some: { id: 'l1' } } } })
  })
})

describe('a policy edit enqueues the re-evaluation (ADEV-281)', () => {
  const stored = (tradeoffPolicy: unknown) => ({
    id: 'p1', ownerId: 'u1', orchestrationPolicy: tradeoffPolicy, members: [], lists: [],
  })

  it('when the trade-off key changed', async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue(stored(null) as never)
    const result = await setProjectOrchestrationPolicy('p1', 'u1', { policy: { tradeoff: { goalOrder: ['g1'] } } })
    expect(result.ok).toBe(true)
    expect(enqueueJob).toHaveBeenCalledWith('tradeoff-reevaluate', { projectId: 'p1', listId: null, afterTaskId: null })
  })

  it('when the policy is taken away, so stored labels are cleared', async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue(stored({ tradeoff: {} }) as never)
    await setProjectOrchestrationPolicy('p1', 'u1', { policy: null })
    expect(enqueueJob).toHaveBeenCalledTimes(1)
  })

  it('not when an edit leaves the trade-off key alone', async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue(stored({ tradeoff: {} }) as never)
    await setProjectOrchestrationPolicy('p1', 'u1', { policy: { tradeoff: {}, autonomy: { merge: 'ask' } } })
    expect(enqueueJob).not.toHaveBeenCalled()
  })

  it('refuses a value outside the vocabulary and queues nothing', async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue(stored(null) as never)
    const result = await setProjectOrchestrationPolicy('p1', 'u1', { policy: { tradeoff: { risk: { reviewAt: 'scary' } } } })
    expect(result).toMatchObject({ ok: false, status: 400 })
    expect(enqueueJob).not.toHaveBeenCalled()
  })
})

describe('the task wire shape (ADEV-281)', () => {
  it('carries no estimate key where no label is stored, which is every task on a project with no policy', () => {
    expect(v1TaskEstimatePatch(undefined)).toEqual({})
    expect(v1TaskEstimatePatch([])).toEqual({})
    expect(v1TaskEstimatePatch([{ label: null, labelReasons: null, sortKey: null }])).toEqual({})
  })

  it('carries the label, reasons and key of the latest estimate', () => {
    expect(v1TaskEstimate([{ label: 'do-now', labelReasons: [{ code: 'goalImproves' }], sortKey: [0, 1] }])).toEqual({
      label: 'do-now',
      labelReasons: [{ code: 'goalImproves' }],
      sortKey: [0, 1],
    })
  })

  it('drops a row whose key is not a list of numbers rather than sorting on garbage', () => {
    expect(v1TaskEstimate([{ label: 'do-now', labelReasons: [], sortKey: ['0'] }])).toBeUndefined()
    expect(v1TaskEstimate([{ label: 'do-now', labelReasons: [], sortKey: [] }])).toBeUndefined()
  })
})
