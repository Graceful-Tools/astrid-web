/**
 * ADEV-284: acting on a label. The board's policy decides what the server does about a `do-now`
 * estimate or an experiment recommendation: `allowed` acts, `ask` posts a card bound to a digest of the
 * snapshot, `never` (the default) only recommends. A built-in estimate, one below `minConfidenceToAct`
 * and any failure to resolve the policy never act.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  task: { findUnique: vi.fn() },
  project: { findUnique: vi.fn() },
  projectConnector: { findFirst: vi.fn() },
  taskEstimate: { findFirst: vi.fn() },
  taskExperiment: { findFirst: vi.fn(), findMany: vi.fn() },
  comment: { create: vi.fn(), findFirst: vi.fn() },
}))
const requestApproval = vi.hoisted(() => vi.fn())
const updateTaskWithSideEffects = vi.hoisted(() => vi.fn())
const sourceTargetFor = vi.hoisted(() => vi.fn())
const postExperimentAction = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/services/approval.service', () => ({ requestApproval }))
vi.mock('@/services/task.service', () => ({ updateTaskWithSideEffects }))
vi.mock('@/services/project-connectors.service', () => ({ sourceTargetFor }))
vi.mock('@/lib/experiment-source-client', () => ({ postExperimentAction }))

import { actOnGoalSignal, carryOutApprovedGoalAction, estimateDigest, experimentDigest } from '@/services/goal-action.service'

let policy: unknown
const estimate = (over: Record<string, unknown> = {}) => ({
  id: 'e1',
  taskId: 't1',
  projectId: 'p1',
  source: 'service:est',
  label: 'do-now',
  policyDigest: 'p'.repeat(40),
  confidence: 'high',
  ...over,
})
const experiment = (over: Record<string, unknown> = {}) => ({
  id: 'x1',
  taskId: 't1',
  projectId: 'p1',
  kind: 'experiment',
  connectorId: 'c1',
  externalKey: 'exp-1',
  state: 'pending',
  verdict: null,
  recommendation: { action: 'start', reason: 'ready' },
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  policy = { autonomy: { promoteIdea: 'allowed', experimentStart: 'allowed', experimentStop: 'allowed' } }
  prismaMock.project.findUnique.mockImplementation(async () => ({ ownerId: 'owner', orchestrationPolicy: policy }))
  prismaMock.task.findUnique.mockResolvedValue({ statusRole: null, completed: false, title: 'Idea', lists: [] })
  prismaMock.taskEstimate.findFirst.mockResolvedValue(estimate())
  prismaMock.comment.findFirst.mockResolvedValue(null)
  prismaMock.comment.create.mockResolvedValue({})
  requestApproval.mockResolvedValue({ ok: true, value: { id: 'card1', created: true } })
  updateTaskWithSideEffects.mockResolvedValue({ ok: true })
  sourceTargetFor.mockReturnValue({ target: { baseUrl: 'https://x.test', credential: null, userSuppliedUrl: false }, error: null })
  prismaMock.projectConnector.findFirst.mockResolvedValue({ id: 'c1' })
  postExperimentAction.mockResolvedValue({ ok: true })
})

describe('promote idea (ADEV-284)', () => {
  it('allowed: moves a do-now idea to Ready', async () => {
    const outcome = await actOnGoalSignal('t1', 'promoteIdea')
    expect(outcome.status).toBe('acted')
    expect(updateTaskWithSideEffects).toHaveBeenCalledWith(expect.objectContaining({ taskId: 't1', intent: { statusRole: 'ready' } }))
  })

  it('never (the default): a recommendation only', async () => {
    policy = null
    const outcome = await actOnGoalSignal('t1', 'promoteIdea')
    expect(outcome.status).toBe('recommendation')
    expect(updateTaskWithSideEffects).not.toHaveBeenCalled()
    expect(requestApproval).not.toHaveBeenCalled()
  })

  it('ask: posts a card bound to the estimate digest and moves nothing', async () => {
    policy = { autonomy: { promoteIdea: 'ask' } }
    const outcome = await actOnGoalSignal('t1', 'promoteIdea')
    expect(outcome).toEqual({ status: 'asked', action: 'promoteIdea', commentId: 'card1' })
    const digest = estimateDigest(estimate() as never)
    expect(digest).toMatch(/^[0-9a-f]{40}$/)
    expect(requestApproval).toHaveBeenCalledWith(expect.objectContaining({ request: { action: 'promoteIdea', sha: digest } }))
    expect(updateTaskWithSideEffects).not.toHaveBeenCalled()
  })

  it('a newer estimate is a different digest', () => {
    expect(estimateDigest(estimate({ id: 'e2' }) as never)).not.toBe(estimateDigest(estimate() as never))
  })

  it('never acts on a built-in estimate, even when allowed', async () => {
    prismaMock.taskEstimate.findFirst.mockResolvedValue(estimate({ source: 'builtin_llm' }))
    expect((await actOnGoalSignal('t1', 'promoteIdea')).status).toBe('recommendation')
    expect(updateTaskWithSideEffects).not.toHaveBeenCalled()
  })

  it('never acts below minConfidenceToAct', async () => {
    policy = { autonomy: { promoteIdea: 'allowed' }, tradeoff: { minConfidenceToAct: 'high' } }
    prismaMock.taskEstimate.findFirst.mockResolvedValue(estimate({ confidence: 'medium' }))
    expect((await actOnGoalSignal('t1', 'promoteIdea')).status).toBe('recommendation')
    expect(updateTaskWithSideEffects).not.toHaveBeenCalled()
  })

  it('never acts on a label other than do-now', async () => {
    prismaMock.taskEstimate.findFirst.mockResolvedValue(estimate({ label: 'needs-review' }))
    expect((await actOnGoalSignal('t1', 'promoteIdea')).status).toBe('recommendation')
    expect(updateTaskWithSideEffects).not.toHaveBeenCalled()
  })

  it('fails closed when the stored policy does not parse', async () => {
    policy = { autonomy: { promoteIdea: 'sometimes' } }
    expect((await actOnGoalSignal('t1', 'promoteIdea')).status).toBe('recommendation')
    expect(updateTaskWithSideEffects).not.toHaveBeenCalled()
  })

  it('fails closed when reading the policy throws', async () => {
    prismaMock.project.findUnique.mockRejectedValue(new Error('db down'))
    expect((await actOnGoalSignal('t1', 'promoteIdea')).status).toBe('recommendation')
    expect(updateTaskWithSideEffects).not.toHaveBeenCalled()
  })

  it('an approved card with a stale digest runs nothing', async () => {
    const result = await carryOutApprovedGoalAction('t1', { action: 'promoteIdea', sha: 'a'.repeat(40) }, 'person')
    expect(result).toMatchObject({ ok: false, code: 'STALE_SNAPSHOT' })
    expect(updateTaskWithSideEffects).not.toHaveBeenCalled()
  })

  it('an approved card with the current digest promotes, unless the policy now says never', async () => {
    policy = { autonomy: { promoteIdea: 'ask' } }
    const sha = estimateDigest(estimate() as never)
    expect(await carryOutApprovedGoalAction('t1', { action: 'promoteIdea', sha }, 'person')).toEqual({ ok: true })
    expect(updateTaskWithSideEffects).toHaveBeenCalledTimes(1)

    policy = { autonomy: { promoteIdea: 'never' } }
    expect(await carryOutApprovedGoalAction('t1', { action: 'promoteIdea', sha }, 'person')).toMatchObject({ ok: false, code: 'POLICY_NEVER' })
    expect(updateTaskWithSideEffects).toHaveBeenCalledTimes(1)
  })
})

describe('experiment start and stop (ADEV-284)', () => {
  it('allowed: calls the service with the digest as the idempotency key', async () => {
    prismaMock.taskExperiment.findFirst.mockResolvedValue(experiment())
    expect((await actOnGoalSignal('t1', 'experimentStart', { experimentId: 'x1' })).status).toBe('acted')
    expect(postExperimentAction).toHaveBeenCalledWith(
      expect.anything(),
      { key: 'exp-1', action: 'start', idempotencyKey: experimentDigest(experiment() as never, 'experimentStart'), approvedBy: 'policy' },
    )
  })

  it('ask: posts a card and does not call the service', async () => {
    policy = { autonomy: { experimentStop: 'ask' } }
    prismaMock.taskExperiment.findFirst.mockResolvedValue(experiment({ state: 'running', recommendation: { action: 'stop', reason: 'done' } }))
    expect((await actOnGoalSignal('t1', 'experimentStop', { experimentId: 'x1' })).status).toBe('asked')
    expect(postExperimentAction).not.toHaveBeenCalled()
  })

  it('never: does not call the service', async () => {
    policy = null
    prismaMock.taskExperiment.findFirst.mockResolvedValue(experiment())
    expect((await actOnGoalSignal('t1', 'experimentStart', { experimentId: 'x1' })).status).toBe('recommendation')
    expect(postExperimentAction).not.toHaveBeenCalled()
  })

  it('does not stop an experiment that is not running', async () => {
    prismaMock.taskExperiment.findFirst.mockResolvedValue(experiment({ state: 'pending' }))
    expect((await actOnGoalSignal('t1', 'experimentStop', { experimentId: 'x1' })).status).toBe('recommendation')
    expect(postExperimentAction).not.toHaveBeenCalled()
  })

  it('does not ask twice for the same snapshot', async () => {
    policy = { autonomy: { experimentStart: 'ask' } }
    prismaMock.taskExperiment.findFirst.mockResolvedValue(experiment())
    prismaMock.comment.findFirst.mockResolvedValue({ id: 'old-card' })
    expect((await actOnGoalSignal('t1', 'experimentStart', { experimentId: 'x1' })).status).toBe('recommendation')
    expect(requestApproval).not.toHaveBeenCalled()
  })

  it('an approved card whose snapshot moved on runs nothing', async () => {
    prismaMock.taskExperiment.findMany.mockResolvedValue([experiment({ recommendation: { action: 'start', reason: 'changed' } })])
    const sha = experimentDigest(experiment() as never, 'experimentStart')
    expect(await carryOutApprovedGoalAction('t1', { action: 'experimentStart', sha }, 'person')).toMatchObject({ ok: false, code: 'STALE_SNAPSHOT' })
    expect(postExperimentAction).not.toHaveBeenCalled()
  })

  it('a failing service is reported, not swallowed', async () => {
    prismaMock.taskExperiment.findFirst.mockResolvedValue(experiment())
    postExperimentAction.mockResolvedValue({ ok: false, kind: 'client', error: 'The service answered 404' })
    expect(await actOnGoalSignal('t1', 'experimentStart', { experimentId: 'x1' })).toMatchObject({ status: 'failed' })
  })
})
