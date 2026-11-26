/**
 * ADEV-279: experiment links and verifications report on EVERY board, and the Pending results lane
 * rules (complete, hand back) run only for a task that is in the column. A board that never added the
 * column still gets the verdict and the system comment, and nothing completes, moves or hands back
 * its tasks by rule.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  task: { findUnique: vi.fn(), findMany: vi.fn() },
  project: { findUnique: vi.fn() },
  projectConnector: { findFirst: vi.fn(), update: vi.fn() },
  taskExperiment: { findMany: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
  comment: { create: vi.fn() },
}))
const canUseGoalSignals = vi.hoisted(() => vi.fn())
const completeTask = vi.hoisted(() => vi.fn())
const updateTaskWithSideEffects = vi.hoisted(() => vi.fn())
const recordGoalMeasurement = vi.hoisted(() => vi.fn())
const pollGoalMetrics = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/goal-signals', () => ({ canUseGoalSignals }))
vi.mock('@/services/complete-task', () => ({ completeTask }))
vi.mock('@/services/task.service', () => ({ updateTaskWithSideEffects }))
vi.mock('@/services/project-goals.service', () => ({ recordGoalMeasurement, recordGuardrailReading: vi.fn() }))
vi.mock('@/lib/goal-signals-poll', () => ({ pollGoalMetrics }))
vi.mock('node:dns/promises', () => ({ lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]) }))

import {
  getTaskExperiments,
  linkTaskExperiment,
  refreshExperimentRow,
  refreshTaskExperiments,
  runResultsSettlePass,
  settleResultsTask,
} from '@/services/task-experiment.service'

const NOW = new Date('2026-11-26T12:00:00Z')
const iso = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString()

const goals = (over: { current?: number; at?: string } = {}) => ({
  goals: [
    {
      id: 'g1',
      statement: 'Convert more',
      metric: { direction: 'up', unit: '%', current: over.current, measuredAt: over.at, source: { connectorId: 'mc', metricKey: 'conv' } },
    },
  ],
  guardrails: [],
})

const task = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  creatorId: 'creator',
  statusRole: 'doing',
  completed: false,
  lists: [{ id: 'l1', ownerId: 'owner', orchestrationPolicy: null, project: { id: 'p1', ownerId: 'owner', goalsAndGuardrails: goals(), orchestrationPolicy: null } }],
  ...over,
})

let rows: Array<Record<string, any>>
const row = (over: Record<string, unknown> = {}) => ({
  id: 'x1',
  taskId: 't1',
  projectId: 'p1',
  kind: 'experiment',
  connectorId: 'c1',
  externalKey: 'exp-412',
  url: null,
  state: 'running',
  verdict: null,
  recommendation: null,
  snapshot: null,
  snapshotDigest: null,
  baseline: null,
  startedAt: null,
  decideBy: null,
  fetchedAt: new Date(NOW.getTime() - 3_600_000),
  lastError: null,
  returnAssigneeId: null,
  createdAt: new Date(NOW.getTime() - 86_400_000),
  ...over,
})

/** The experiment service answers one entry for the key. */
const serviceSays = (entry: Record<string, unknown>) =>
  (async () => new Response(JSON.stringify({ experiments: [{ key: 'exp-412', at: iso(0.5), state: 'concluded', ...entry }] }), { status: 200 })) as unknown as typeof fetch

beforeEach(() => {
  vi.resetAllMocks()
  process.env.ASTRID_SIGNAL_SERVICES = JSON.stringify([{ key: 'exp', kind: 'experiment', name: 'Exp', baseUrl: 'https://exp.example.com', secretEnv: 'EXP_KEY' }])
  process.env.EXP_KEY = 'k'
  rows = [row()]
  canUseGoalSignals.mockResolvedValue(true)
  prismaMock.task.findUnique.mockResolvedValue(task())
  prismaMock.project.findUnique.mockResolvedValue({ id: 'p1', ownerId: 'owner', goalsAndGuardrails: goals() })
  prismaMock.projectConnector.findFirst.mockResolvedValue({ id: 'c1', projectId: 'p1', kind: 'experiment', serviceKey: 'exp', endpointUrl: null, credentialEnc: null })
  prismaMock.projectConnector.update.mockResolvedValue({})
  prismaMock.taskExperiment.findMany.mockImplementation(async () => rows)
  prismaMock.taskExperiment.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
    const i = rows.findIndex(r => r.id === where.id)
    rows[i] = { ...rows[i], ...data }
    return rows[i]
  })
  prismaMock.comment.create.mockResolvedValue({})
  prismaMock.task.findMany.mockResolvedValue([])
  completeTask.mockResolvedValue({ ok: true })
  updateTaskWithSideEffects.mockResolvedValue({ ok: true })
  recordGoalMeasurement.mockResolvedValue({ ok: true })
  pollGoalMetrics.mockResolvedValue({})
})

const systemComments = () => prismaMock.comment.create.mock.calls.map(([arg]) => arg.data as { content: string; systemEventType: string; authorId: null })

describe('a board without the Pending results column still gets results (ADEV-279)', () => {
  it('records the verdict and reports it on the task, and changes nothing else', async () => {
    const out = await refreshExperimentRow(rows[0] as never, {
      now: NOW,
      fetchImpl: serviceSays({ verdict: 'improving', recommendation: { action: 'ship', reason: 'lift' }, metrics: [{ metricKey: 'conv', goalId: 'g1', control: 6, treatment: 6.4, relDelta: 0.067, significant: true }] }),
    })
    expect(out.concluded).toBe(true)
    expect(rows[0]).toMatchObject({ state: 'concluded', verdict: 'improving', lastError: null })
    const comments = systemComments()
    expect(comments).toHaveLength(1)
    expect(comments[0]).toMatchObject({ authorId: null, systemEventType: 'EXPERIMENT_RESULT' })
    expect(comments[0].content).toContain('improving')
    expect(comments[0].content).toContain('conv: 6 → 6.4, +6.7%, significant')

    // The task is in Doing: the lane rules do not run, so nothing completes or moves it.
    prismaMock.task.findUnique.mockResolvedValue(task({ statusRole: 'doing' }))
    expect(await settleResultsTask('t1', NOW)).toBe('not-in-column')
    expect(completeTask).not.toHaveBeenCalled()
    expect(updateTaskWithSideEffects).not.toHaveBeenCalled()
    expect(recordGoalMeasurement).not.toHaveBeenCalled()
  })

  it('a regression is reported too, and still hands nothing back outside the column', async () => {
    await refreshExperimentRow(rows[0] as never, { now: NOW, fetchImpl: serviceSays({ verdict: 'regressing' }) })
    expect(rows[0]).toMatchObject({ state: 'concluded', verdict: 'regressing' })
    expect(systemComments()[0].content).toContain('regressing')
    expect(await settleResultsTask('t1', NOW)).toBe('not-in-column')
    expect(updateTaskWithSideEffects).not.toHaveBeenCalled()
    expect(completeTask).not.toHaveBeenCalled()
  })

  it('the scheduled pass refreshes and records, and leaves a task outside the column alone', async () => {
    const fetchImpl = serviceSays({ verdict: 'improving' })
    const summary = await runResultsSettlePass({ now: NOW, fetchImpl })
    expect(summary).toMatchObject({ links: 1, refreshed: 1, concluded: 1, tasksSettled: 0, completed: 0, handedBack: 0 })
    expect(rows[0].verdict).toBe('improving')
    expect(completeTask).not.toHaveBeenCalled()
    expect(updateTaskWithSideEffects).not.toHaveBeenCalled()
  })

  it('a person’s Refresh reports the same way and says the task is not in the column', async () => {
    const out = await refreshTaskExperiments('t1', { now: NOW, fetchImpl: serviceSays({ verdict: 'improving' }) })
    expect(out).toMatchObject({ ok: true, value: { lane: 'not-in-column', inResultsColumn: false } })
    expect(completeTask).not.toHaveBeenCalled()
  })

  it('reports once: a link that is already concluded is not read or reported again', async () => {
    rows = [row({ state: 'concluded', verdict: 'improving' })]
    const fetchImpl = vi.fn()
    const out = await refreshExperimentRow(rows[0] as never, { now: NOW, fetchImpl: fetchImpl as never })
    expect(out.concluded).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(prismaMock.comment.create).not.toHaveBeenCalled()
  })
})

describe('a task in the Pending results column follows the lane rules (ADEV-279)', () => {
  beforeEach(() => {
    prismaMock.task.findUnique.mockResolvedValue(task({ statusRole: 'results' }))
  })

  it('passed: completes the task, says so, and records a goal measurement that names it', async () => {
    prismaMock.project.findUnique.mockResolvedValue({ id: 'p1', ownerId: 'owner', goalsAndGuardrails: goals({ current: 6.4, at: iso(1) }) })
    rows = [row({ state: 'concluded', verdict: 'improving', snapshot: { metrics: [{ metricKey: 'conv', goalId: 'g1' }] } })]
    expect(await settleResultsTask('t1', NOW)).toBe('completed')
    expect(completeTask).toHaveBeenCalledWith(expect.objectContaining({ taskId: 't1', completedSource: 'results' }))
    expect(systemComments()[0]).toMatchObject({ systemEventType: 'RESULTS_PASSED' })
    expect(recordGoalMeasurement).toHaveBeenCalledWith(
      'p1',
      'owner',
      'g1',
      expect.objectContaining({ value: 6.4, taskId: 't1', externalId: 'results:t1:g1' }),
      'results-settle',
      'pull',
    )
  })

  it('regressing: hands the task back to the escalation target with a Decision, and rolls nothing back', async () => {
    rows = [row({ state: 'concluded', verdict: 'regressing' })]
    expect(await settleResultsTask('t1', NOW)).toBe('handed-back')
    expect(completeTask).not.toHaveBeenCalled()
    expect(updateTaskWithSideEffects).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 't1', intent: { statusRole: null, assigneeId: 'owner', assigneeIds: ['owner'] } }),
    )
    const [comment] = systemComments()
    expect(comment.systemEventType).toBe('RESULTS_HANDED_BACK')
    expect(comment.content).toContain('**Decision:**')
    expect(comment.content).toMatch(/- \*\*1\.\*\* Iterate.*\(recommended\)/)
    expect(comment.content).toContain('Roll back')
    expect(comment.content).toContain('Ship anyway')
    expect(comment.content).toContain('Nothing has been rolled back')
  })

  it('not yet: an open experiment keeps the task where it is', async () => {
    rows = [row({ state: 'running' })]
    expect(await settleResultsTask('t1', NOW)).toBe('stay')
    expect(completeTask).not.toHaveBeenCalled()
    expect(updateTaskWithSideEffects).not.toHaveBeenCalled()
  })

  it('a source silent past decideBy hands the task back', async () => {
    rows = [row({ state: 'running', decideBy: new Date(NOW.getTime() - 3_600_000) })]
    expect(await settleResultsTask('t1', NOW)).toBe('handed-back')
    expect(systemComments()[0].content).toContain('had nothing to say')
  })

  it('the scheduled pass settles it after refreshing the link', async () => {
    prismaMock.task.findMany.mockResolvedValue([{ id: 't1' }])
    const summary = await runResultsSettlePass({ now: NOW, fetchImpl: serviceSays({ verdict: 'improving' }) })
    expect(summary).toMatchObject({ refreshed: 1, concluded: 1, completed: 1, handedBack: 0 })
    expect(completeTask).toHaveBeenCalledTimes(1)
  })

  it('a task that is already completed is not touched', async () => {
    prismaMock.task.findUnique.mockResolvedValue(task({ statusRole: 'results', completed: true }))
    expect(await settleResultsTask('t1', NOW)).toBe('not-in-column')
    expect(completeTask).not.toHaveBeenCalled()
  })
})

describe('refreshing a link (ADEV-279)', () => {
  it('a failing source is recorded and the last good result stays', async () => {
    rows = [row({ state: 'running', verdict: null })]
    const down = (async () => new Response('', { status: 503 })) as unknown as typeof fetch
    const out = await refreshExperimentRow(rows[0] as never, { now: NOW, fetchImpl: down })
    expect(out.failed).toBe(true)
    expect(out.concluded).toBe(false)
    expect(rows[0]).toMatchObject({ state: 'running', lastError: 'The service answered 503' })
    expect(rows[0].fetchedAt).toEqual(new Date(NOW.getTime() - 3_600_000))
    expect(prismaMock.comment.create).not.toHaveBeenCalled()
  })

  it('costs a project that lost the feature no request', async () => {
    canUseGoalSignals.mockResolvedValue(false)
    const fetchImpl = vi.fn()
    const out = await refreshExperimentRow(rows[0] as never, { now: NOW, fetchImpl: fetchImpl as never })
    expect(out.concluded).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('a verification before decideBy records progress, with no verdict and no report', async () => {
    rows = [row({ kind: 'verification', state: 'running', connectorId: null, externalKey: null, decideBy: new Date(NOW.getTime() + 86_400_000), baseline: { at: iso(30), goals: [], guardrails: [] } })]
    const out = await refreshExperimentRow(rows[0] as never, { now: NOW })
    expect(out.concluded).toBe(false)
    expect(rows[0]).toMatchObject({ state: 'running', verdict: null })
    expect(pollGoalMetrics).not.toHaveBeenCalled()
    expect(prismaMock.comment.create).not.toHaveBeenCalled()
  })

  it('a verification at decideBy reads the project’s sources, compares with the baseline and reports', async () => {
    rows = [
      row({
        kind: 'verification',
        state: 'running',
        connectorId: null,
        externalKey: null,
        decideBy: new Date(NOW.getTime() - 60_000),
        baseline: { at: iso(24 * 7), goals: [{ id: 'g1', value: 6, at: iso(24 * 7) }], guardrails: [] },
      }),
    ]
    prismaMock.project.findUnique.mockResolvedValue({ id: 'p1', ownerId: 'owner', goalsAndGuardrails: goals({ current: 6.5, at: iso(0.2) }) })
    const out = await refreshExperimentRow(rows[0] as never, { now: NOW })
    expect(pollGoalMetrics).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1' }))
    expect(out.concluded).toBe(true)
    expect(rows[0]).toMatchObject({ state: 'concluded', verdict: 'improving' })
    expect(systemComments()[0].content).toContain('The verification window ended')
    expect(systemComments()[0].content).toContain('Convert more: 6 → 6.5')
  })

  it('a verification whose goal regressed is regressing', async () => {
    rows = [row({ kind: 'verification', state: 'running', connectorId: null, externalKey: null, decideBy: new Date(NOW.getTime() - 60_000), baseline: { at: iso(24 * 7), goals: [{ id: 'g1', value: 6, at: iso(24 * 7) }], guardrails: [] } })]
    prismaMock.project.findUnique.mockResolvedValue({ id: 'p1', ownerId: 'owner', goalsAndGuardrails: goals({ current: 5, at: iso(0.2) }) })
    await refreshExperimentRow(rows[0] as never, { now: NOW })
    expect(rows[0]).toMatchObject({ state: 'concluded', verdict: 'regressing' })
  })
})

describe('linking (ADEV-279)', () => {
  beforeEach(() => {
    prismaMock.taskExperiment.count.mockResolvedValue(0)
    prismaMock.taskExperiment.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => row({ id: 'new', ...data }))
  })

  it('a verification records the project’s fresh goal values as its baseline, now', async () => {
    prismaMock.task.findUnique.mockResolvedValue(task({ lists: [{ id: 'l1', ownerId: 'owner', orchestrationPolicy: null, project: { id: 'p1', ownerId: 'owner', goalsAndGuardrails: goals({ current: 6, at: iso(2) }), orchestrationPolicy: null } }] }))
    const out = await linkTaskExperiment('t1', { kind: 'verification', days: 7 }, NOW)
    expect(out).toMatchObject({ ok: true, value: { kind: 'verification', state: 'running', decideBy: '2026-12-03T12:00:00.000Z' } })
    const data = prismaMock.taskExperiment.create.mock.calls[0][0].data
    expect(data.baseline).toMatchObject({ at: NOW.toISOString(), goals: [{ id: 'g1', value: 6 }] })
  })

  it('refuses a window with no end, or one already past', async () => {
    expect(await linkTaskExperiment('t1', { kind: 'verification' }, NOW)).toMatchObject({ ok: false, status: 400 })
    expect(await linkTaskExperiment('t1', { kind: 'verification', decideBy: iso(1) }, NOW)).toMatchObject({ ok: false, status: 400 })
    expect(prismaMock.taskExperiment.create).not.toHaveBeenCalled()
  })

  it('links an experiment only through one of the project’s experiment connectors', async () => {
    prismaMock.projectConnector.findFirst.mockResolvedValue(null)
    expect(await linkTaskExperiment('t1', { kind: 'experiment', connectorId: 'metric-one', externalKey: 'e' }, NOW)).toMatchObject({ ok: false, status: 404 })
    expect(prismaMock.projectConnector.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ kind: 'experiment', projectId: 'p1' }) }))
    prismaMock.projectConnector.findFirst.mockResolvedValue({ id: 'c1' })
    expect(await linkTaskExperiment('t1', { kind: 'experiment', connectorId: 'c1', externalKey: 'exp-412', url: 'https://exp.example.com/412' }, NOW)).toMatchObject({
      ok: true,
      value: { kind: 'experiment', externalKey: 'exp-412', state: 'running' },
    })
    expect(await linkTaskExperiment('t1', { kind: 'experiment', connectorId: 'c1' }, NOW)).toMatchObject({ ok: false, status: 400 })
    expect(await linkTaskExperiment('t1', { kind: 'experiment', connectorId: 'c1', externalKey: 'e', url: 'http://x' }, NOW)).toMatchObject({ ok: false, status: 400 })
  })

  it('is refused where goal signals are off for the project, and past the per-task cap', async () => {
    canUseGoalSignals.mockResolvedValue(false)
    expect(await linkTaskExperiment('t1', { kind: 'verification', days: 3 }, NOW)).toMatchObject({ ok: false, status: 404 })
    canUseGoalSignals.mockResolvedValue(true)
    prismaMock.taskExperiment.count.mockResolvedValue(10)
    expect(await linkTaskExperiment('t1', { kind: 'verification', days: 3 }, NOW)).toMatchObject({ ok: false, status: 400 })
  })

  it('reads the task’s links and whether it is in the column', async () => {
    rows = [row({ state: 'concluded', verdict: 'flat' })]
    prismaMock.task.findUnique.mockResolvedValue(task({ statusRole: 'results' }))
    expect(await getTaskExperiments('t1')).toMatchObject({ ok: true, value: { inResultsColumn: true, experiments: [{ verdict: 'flat', state: 'concluded' }] } })
  })
})
