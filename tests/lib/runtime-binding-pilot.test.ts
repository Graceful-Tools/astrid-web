/**
 * AWTD-1669 — the runtime-binding pilot: one enrolled polling runtime,
 * concurrency one, business-provided credentials only.
 *
 * RFC docs/architecture/BUSINESS_RUNTIME_BINDING_RFC.md §10, against an
 * in-memory database that runs the REAL where clauses (tests/fixtures/
 * runtime-binding-pilot-db.ts):
 *
 *  - Row 2, bound happy path: exactly one eligible runtime/agent/payer and one
 *    authorized run; unrelated boards and principals can neither discover nor
 *    claim the work.
 *  - Row 3, invalid/revoked/missing binding, ambiguous boards, missing
 *    credential or payer, dependency outage: a visible denial, audited, with
 *    zero fallback — no task write, no personal dispatch.
 *  - Row 4, concurrent claims and configuration changes: no duplicate run, no
 *    oversubscription; stale plans and leases fenced before the write.
 *
 * The flags-off half (evidence row 1 for these paths) is
 * tests/lib/runtime-binding-pilot-flags-off.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentEmail } from '@/lib/brand/agent-emails'
import { pilotDb as db } from '@/tests/fixtures/runtime-binding-pilot-db'

vi.mock('@/lib/prisma', async () => ({
  prisma: (await import('@/tests/fixtures/runtime-binding-pilot-db')).pilotDb.client,
}))

import { claimFixallTask } from '@/services/fixall-claim.service'
import { claimAgentTask } from '@/services/agent-task-claim.service'
import { buildAgentQueue } from '@/lib/agent-queue'
import { RuntimeBindingDeniedError } from '@/lib/ai/runtime-binding-resolver'
import {
  boundDispatchHold,
  gateTaskRuntime,
  hiddenBoundBoardsFilter,
  runtimePrincipalOf,
} from '@/lib/runtime-binding/task-runtime'
import { runFencedClaim } from '@/lib/runtime-binding/claim-fence'
import { executorGrantFor } from '@/lib/runtime-binding/executor-credential'
import { runtimeBindingDenialStatus } from '@/lib/runtime-binding/denial-response'
import type { FixallClaimRequest } from '@/lib/fixall-claim'

const RUNTIME = 'astrid_client_0123456789abcdef0123456789abcdef'
const STRANGER = 'astrid_client_ffffffffffffffffffffffffffffffff'
const CLAUDE = agentEmail('claude')
const CODEX = agentEmail('codex')
const CREDENTIAL_REF = 'cred:build-01:gen1'
const PAYER_REF = 'payer:acme-business'

function seed() {
  db.reset()
  db.users.push(
    { id: 'agent-claude', email: CLAUDE, name: 'Claude', isAIAgent: true, isActive: true },
    { id: 'agent-codex', email: CODEX, name: 'Codex', isAIAgent: true, isActive: true },
    { id: 'user-1', email: 'owner@example.test', name: 'Owner', isAIAgent: false, isActive: true },
  )
  db.bindings.push(binding('binding-1', { allowedBoardIds: ['board-a', 'board-b'] }))
  db.bindings.push(binding('binding-2', { allowedBoardIds: ['board-x'], runtimeSubjectId: STRANGER }))
  db.lists.push(
    list('board-a', 'binding-1'),
    list('board-b', 'binding-1'),
    list('board-u', null),
    list('board-x', 'binding-2'),
  )
  db.tasks.push(
    task('t-a1', ['board-a']),
    task('t-a2', ['board-a']),
    task('t-b1', ['board-b']),
    task('t-u1', ['board-u']),
    task('t-mixed', ['board-a', 'board-u']),
    task('t-conflict', ['board-a', 'board-x']),
  )
}

function binding(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    revision: 3,
    managementScope: 'deployment-business',
    runtimeKind: 'business-machine',
    runtimeSubjectId: RUNTIME,
    runtimeCustodianUserId: null,
    allowedAgentIds: ['claude'],
    transport: 'polling',
    endpointRef: null,
    credentialRef: CREDENTIAL_REF,
    allowedRepositoryRefs: [],
    allowedBoardIds: [] as string[],
    maxConcurrentRuns: 1,
    billingSource: 'business-provided',
    billingAccountRef: PAYER_REF,
    state: 'active',
    approvedBy: 'admin-1',
    approvedRevision: 3,
    ...overrides,
  }
}
function list(id: string, runtimeBindingId: string | null) {
  return { id, name: id, runtimeBindingId, ownerId: 'user-1', privacy: 'PRIVATE', githubRepositoryId: null }
}
function task(id: string, listIds: string[], overrides: Record<string, unknown> = {}) {
  return {
    id, identifier: id.toUpperCase(), title: id, description: null, priority: 1,
    completed: false, completedAt: null, statusRole: 'ready', dueDateTime: null, isAllDay: false,
    assigneeId: 'agent-claude', assigneeIds: ['agent-claude'], listIds,
    createdAt: new Date('2026-11-01T00:00:00Z'), updatedAt: new Date('2026-11-01T00:00:00Z'),
    ...overrides,
  }
}
const readyClaim = (listId: string, agent = 'claude'): FixallClaimRequest =>
  ({ action: 'ready', commentWatermark: null, agent, listId })
const status = (id: string) => db.tasks.find(t => t.id === id)!.statusRole
const doing = () => db.tasks.filter(t => t.statusRole === 'doing').map(t => t.id).sort()
const auditsOf = (type: string) => db.audits.filter(a => a.eventType === type)

beforeEach(() => {
  vi.stubEnv('ASTRID_RUNTIME_BINDING_RESOLVER', 'true')
  vi.stubEnv('ASTRID_RUNTIME_BINDING_SINGLE_BUSINESS', 'true')
  seed()
})
afterEach(() => {
  vi.unstubAllEnvs()
})

// ── Row 2: the bound happy path ─────────────────────────────────────────────

describe('AWTD-1669 row 2 — bound happy path', () => {
  it('the enrolled runtime claims a bound task: one run, one run-started audit, attributed to the approved revision', async () => {
    const result = await claimFixallTask('t-a1', readyClaim('board-a'), { principal: RUNTIME, actorUserId: 'user-1' })

    expect(result).toEqual({ status: 'claimed', assigneeEmail: CLAUDE })
    expect(doing()).toEqual(['t-a1'])
    const [started] = auditsOf('run-started')
    expect(auditsOf('run-started')).toHaveLength(1)
    expect(started).toMatchObject({
      bindingId: 'binding-1',
      bindingRevision: 3,
      actorUserId: 'user-1',
      actorPrincipal: 'claude',
      boardIds: ['board-a'],
      details: { taskId: 't-a1', runtimeSubjectId: RUNTIME, maxConcurrentRuns: 1 },
    })
    // Credential and payer references are never audited.
    expect(JSON.stringify(db.audits)).not.toContain(CREDENTIAL_REF)
    expect(JSON.stringify(db.audits)).not.toContain(PAYER_REF)
  })

  it('the same through the v1 claim service (MCP claim_task)', async () => {
    const result = await claimAgentTask({
      taskId: 't-a1', userId: 'user-1', agentId: 'agent-claude', action: 'claim',
      agentEmail: CLAUDE, principal: RUNTIME,
    })
    expect(result.outcome).toBe('claimed')
    expect(doing()).toEqual(['t-a1'])
    expect(auditsOf('run-started')).toHaveLength(1)
  })

  it('an unbound task claims exactly as before: no fence, no lock, no audit', async () => {
    const result = await claimFixallTask('t-u1', readyClaim('board-u'), { principal: STRANGER })
    expect(result).toEqual({ status: 'claimed', assigneeEmail: CLAUDE })
    expect(db.calls).not.toContain('$queryRaw')
    expect(db.calls).not.toContain('$transaction')
    expect(db.audits).toHaveLength(0)
  })

  it('the queue shows bound work to its runtime and hides it from everyone else — with and without listId', async () => {
    const ids = async (principal: string | null, agent = 'claude', listId: string | null = null) =>
      (await buildAgentQueue({ agent, userId: 'user-1', listId, runtimePrincipal: principal })).queue.map(t => t.id).sort()

    expect(await ids(RUNTIME)).toEqual(['t-a1', 't-a2', 't-b1', 't-mixed', 't-u1'])
    // Unrelated client, no client at all, or an agent the binding does not allow.
    expect(await ids(STRANGER)).toEqual(['t-u1'])
    expect(await ids(null)).toEqual(['t-u1'])
    db.tasks.forEach(t => { t.assigneeId = 'agent-codex' })
    expect(await ids(RUNTIME, 'codex')).toEqual(['t-u1'])
    db.tasks.forEach(t => { t.assigneeId = 'agent-claude' })
    // Named board: its runtime sees it…
    expect(await ids(RUNTIME, 'claude', 'board-a')).toEqual(['t-a1', 't-a2', 't-mixed'])
    // …and anyone else is refused visibly, not shown an empty queue.
    await expect(ids(STRANGER, 'claude', 'board-a')).rejects.toMatchObject({ reason: 'principal-not-runtime' })
    // A task also on a board bound to ANOTHER binding is never discoverable.
    expect(await ids(RUNTIME)).not.toContain('t-conflict')
  })

  it('unassigned Ready work on a bound board is hidden from an unrelated principal too', async () => {
    db.tasks.forEach(t => { t.assigneeId = null })
    const queue = await buildAgentQueue({
      agent: 'claude', userId: 'user-1', listId: 'board-u', includeUnassigned: true, runtimePrincipal: STRANGER,
    })
    expect(queue.queue.map(t => t.id)).toEqual(['t-u1'])
  })

  it('a bound queue response carries identity only, never the credential or payer reference', async () => {
    const queue = await buildAgentQueue({ agent: 'claude', userId: 'user-1', listId: 'board-a', runtimePrincipal: RUNTIME })
    expect(queue.runtimeBinding).toEqual({ id: 'binding-1', revision: 3 })
    expect(queue.mode).toBe('polling')
    const wire = JSON.stringify(queue)
    expect(wire).not.toContain(CREDENTIAL_REF)
    expect(wire).not.toContain(PAYER_REF)
    expect(wire).not.toContain(RUNTIME)
  })

  it('server-side dispatch stands down on a bound board: the polling runtime takes it from the queue', async () => {
    expect(await boundDispatchHold({ taskId: 't-a1', agentEmail: CLAUDE, operation: 'assignment-dispatch' }))
      .toMatch(/polling runtime/)
    expect(await boundDispatchHold({ taskId: 't-u1', agentEmail: CLAUDE, operation: 'assignment-dispatch' }))
      .toBeNull()
  })

  it('the runtime principal is the OAuth client, never the user', () => {
    expect(runtimePrincipalOf({ clientId: RUNTIME })).toBe(RUNTIME)
    expect(runtimePrincipalOf({ clientId: '  ' })).toBeNull()
    expect(runtimePrincipalOf({})).toBeNull()
  })
})

// ── Row 3: visible denial, zero fallback ────────────────────────────────────

describe('AWTD-1669 row 3 — denials are visible, audited and never fall back', () => {
  const cases: Array<[string, () => void, string, string?]> = [
    ['revoked binding', () => { db.bindings[0].state = 'revoked' }, 'binding-not-active'],
    ['suspended binding', () => { db.bindings[0].state = 'suspended' }, 'binding-not-active'],
    ['pending re-approval', () => { db.bindings[0].revision = 4 }, 'revision-unapproved'],
    ['missing binding row', () => { db.bindings.splice(0, 1) }, 'binding-missing'],
    ['board not enrolled', () => { db.bindings[0].allowedBoardIds = ['board-b'] }, 'board-not-enrolled'],
    ['agent not allowed', () => { db.bindings[0].allowedAgentIds = ['codex'] }, 'agent-not-allowed'],
    ['missing credential', () => { db.bindings[0].credentialRef = null }, 'credential-missing'],
    ['missing payer', () => { db.bindings[0].billingAccountRef = '  ' }, 'payer-missing'],
    ['personal payer', () => { db.bindings[0].billingSource = 'personal-authorized' }, 'payer-not-business'],
    ['deployment-hosted payer', () => { db.bindings[0].billingSource = 'deployment-hosted' }, 'payer-not-business'],
    ['webhook transport', () => { db.bindings[0].transport = 'signed-webhook' }, 'transport-unsupported'],
    ['dependency outage', () => { db.failBindingLookup = true }, 'binding-lookup-failed'],
  ]

  it.each(cases)('%s → claim refused with %s, no write, claim-denied audited', async (_label, arrange, reason) => {
    arrange()
    const result = await claimFixallTask('t-a1', readyClaim('board-a'), { principal: RUNTIME, actorUserId: 'user-1' })
    expect(result).toMatchObject({ status: 'binding-denied', denial: { reason } })
    expect(status('t-a1')).toBe('ready')
    expect(auditsOf('run-started')).toHaveLength(0)
    const [denied] = auditsOf('claim-denied')
    expect(denied).toMatchObject({ reasonCode: reason, details: { taskId: 't-a1' } })
    // A missing row cannot be referenced; its id is kept in the details.
    if (reason === 'binding-missing') expect(denied).toMatchObject({ bindingId: null, details: { missingBindingId: 'binding-1' } })
  })

  it.each(cases)('%s → dispatch stands down with %s audited as resolution-denied', async (_label, arrange, reason) => {
    arrange()
    const hold = await boundDispatchHold({ taskId: 't-a1', agentEmail: CLAUDE, operation: 'comment-dispatch' })
    expect(hold).toContain(reason)
    expect(auditsOf('resolution-denied')[0]).toMatchObject({ reasonCode: reason, details: { operation: 'comment-dispatch' } })
  })

  it('an unrelated principal cannot claim: principal-not-runtime, through both claim services', async () => {
    const fixall = await claimFixallTask('t-a1', readyClaim('board-a'), { principal: STRANGER })
    expect(fixall).toMatchObject({ status: 'binding-denied', denial: { reason: 'principal-not-runtime' } })
    const noClient = await claimFixallTask('t-a1', readyClaim('board-a'), {})
    expect(noClient).toMatchObject({ status: 'binding-denied', denial: { reason: 'principal-not-runtime' } })
    const v1 = await claimAgentTask({
      taskId: 't-a1', userId: 'user-1', agentId: 'agent-claude', action: 'claim', agentEmail: CLAUDE, principal: STRANGER,
    })
    expect(v1).toMatchObject({ outcome: 'binding_denied', task: null, binding: { reason: 'principal-not-runtime' } })
    expect(status('t-a1')).toBe('ready')
  })

  it('ambiguous boards: two bindings on one task, or an unbound execution board, are a held conflict — never the first list', async () => {
    const twoBindings = await claimFixallTask('t-conflict', readyClaim('board-a'), { principal: RUNTIME })
    expect(twoBindings).toMatchObject({ status: 'binding-denied', denial: { reason: 'board-conflict' } })
    const unboundBoard = await claimFixallTask('t-mixed', readyClaim('board-u'), { principal: RUNTIME })
    expect(unboundBoard).toMatchObject({ status: 'binding-denied', denial: { reason: 'board-conflict' } })
    expect(status('t-conflict')).toBe('ready')
    expect(status('t-mixed')).toBe('ready')
    expect(await boundDispatchHold({ taskId: 't-conflict', agentEmail: CLAUDE, operation: 'x' })).toContain('board-conflict')
  })

  it('native Copilot dispatch on a bound board is refused: the pilot runs polling only', async () => {
    db.bindings[0].allowedAgentIds = ['copilot']
    db.users.push({ id: 'agent-copilot', email: agentEmail('copilot'), name: 'Copilot', isAIAgent: true, isActive: true })
    const result = await claimFixallTask('t-a1', {
      ...readyClaim('board-a', 'copilot'), nativeDispatch: { repository: 'acme/app', issueNumber: 1 },
    }, { principal: RUNTIME })
    expect(result).toMatchObject({ status: 'binding-denied', denial: { reason: 'transport-unsupported' } })
    expect(status('t-a1')).toBe('ready')
  })

  it('an audit-store outage does not turn a denial into a claim', async () => {
    db.bindings[0].state = 'suspended'
    db.failAuditCreate = true
    const result = await claimFixallTask('t-a1', readyClaim('board-a'), { principal: RUNTIME })
    expect(result).toMatchObject({ status: 'binding-denied', denial: { reason: 'binding-not-active' } })
    expect(status('t-a1')).toBe('ready')
  })

  it('a claim whose run-started record cannot persist rolls back (fail closed)', async () => {
    db.failAuditCreate = true
    const result = await claimFixallTask('t-a1', readyClaim('board-a'), { principal: RUNTIME })
    expect(result).toMatchObject({ status: 'binding-denied' })
    expect(status('t-a1')).toBe('ready')
  })

  it('the queue denial is audited and answered 403 — never an empty or personal queue', async () => {
    db.bindings[0].state = 'revoked'
    const err = await buildAgentQueue({ agent: 'claude', userId: 'user-1', listId: 'board-a', runtimePrincipal: RUNTIME })
      .catch(e => e)
    expect(err).toBeInstanceOf(RuntimeBindingDeniedError)
    expect(err.reason).toBe('binding-not-active')
    expect(auditsOf('resolution-denied')[0]).toMatchObject({ reasonCode: 'binding-not-active', details: { operation: 'agent-queue' } })
    expect(runtimeBindingDenialStatus(err)).toBe(403)
    expect(runtimeBindingDenialStatus({ reason: 'capacity-exhausted' })).toBe(409)
  })

  it('discovery fails closed: a binding lookup outage hides every bound board', async () => {
    db.failBindingLookup = true
    expect(await hiddenBoundBoardsFilter({ principal: RUNTIME, agentEmail: CLAUDE }))
      .toEqual({ runtimeBindingId: { not: null } })
  })

  it('the executor grant is the only place credential and payer references come out, and it denies when either is missing', () => {
    const plan = {
      bindingId: 'b', revision: 1, boardId: 'board-a', agentMailbox: 'claude', runtimeKind: 'business-machine',
      runtimeSubjectId: RUNTIME, transport: 'polling' as const, credentialRef: CREDENTIAL_REF, maxConcurrentRuns: 1,
      payer: { source: 'business-provided' as const, accountRef: PAYER_REF },
    }
    expect(executorGrantFor(plan)).toEqual({ bindingId: 'b', revision: 1, credentialRef: CREDENTIAL_REF, payerAccountRef: PAYER_REF })
    expect(executorGrantFor({ ...plan, credentialRef: '' })).toMatchObject({ reason: 'credential-missing' })
    expect(executorGrantFor({ ...plan, payer: { ...plan.payer, accountRef: '' } })).toMatchObject({ reason: 'payer-missing' })
  })
})

// ── Row 4: concurrency and configuration changes ────────────────────────────

describe('AWTD-1669 row 4 — no duplicate run, no oversubscription, stale plans fenced', () => {
  it('two concurrent claims on DIFFERENT boards sharing one binding: exactly one run, the other capacity-exhausted (409)', async () => {
    const [a, b] = await Promise.all([
      claimFixallTask('t-a1', readyClaim('board-a'), { principal: RUNTIME }),
      claimFixallTask('t-b1', readyClaim('board-b'), { principal: RUNTIME }),
    ])
    const outcomes = [a.status, b.status].sort()
    expect(outcomes).toEqual(['binding-denied', 'claimed'])
    const loser = [a, b].find(r => r.status === 'binding-denied') as { denial: { reason: string } }
    expect(loser.denial.reason).toBe('capacity-exhausted')
    expect(runtimeBindingDenialStatus(loser.denial as never)).toBe(409)
    expect(doing()).toHaveLength(1)
    expect(auditsOf('run-started')).toHaveLength(1)
    expect(auditsOf('capacity-exhausted')).toHaveLength(1)
  })

  it('NEGATIVE CONTROL: without the row lock the same race double-claims — the fence is what prevents it', async () => {
    db.locking = false
    const [a, b] = await Promise.all([
      claimFixallTask('t-a1', readyClaim('board-a'), { principal: RUNTIME }),
      claimFixallTask('t-b1', readyClaim('board-b'), { principal: RUNTIME }),
    ])
    expect([a.status, b.status]).toEqual(['claimed', 'claimed'])
    expect(doing()).toHaveLength(2)
  })

  it('many concurrent claims across both claim services and agents never exceed maxConcurrentRuns = 1', async () => {
    db.bindings[0].allowedAgentIds = ['claude', 'codex']
    const results = await Promise.all([
      claimFixallTask('t-a1', readyClaim('board-a'), { principal: RUNTIME }),
      claimFixallTask('t-a2', readyClaim('board-a', 'codex'), { principal: RUNTIME }),
      claimFixallTask('t-b1', readyClaim('board-b'), { principal: RUNTIME }),
      claimAgentTask({ taskId: 't-a2', userId: 'user-1', agentId: 'agent-claude', action: 'claim', agentEmail: CLAUDE, principal: RUNTIME }),
      claimAgentTask({ taskId: 't-mixed', userId: 'user-1', agentId: 'agent-claude', action: 'claim', agentEmail: CLAUDE, principal: RUNTIME }),
    ])
    expect(doing()).toHaveLength(1)
    expect(auditsOf('run-started')).toHaveLength(1)
    expect(results.filter(r => ('status' in r ? r.status === 'claimed' : r.outcome === 'claimed'))).toHaveLength(1)
  })

  it('two concurrent claims of the SAME task: one run, one ordinary conflict', async () => {
    const [a, b] = await Promise.all([
      claimFixallTask('t-a1', readyClaim('board-a'), { principal: RUNTIME }),
      claimFixallTask('t-a1', readyClaim('board-a'), { principal: RUNTIME }),
    ])
    expect(doing()).toEqual(['t-a1'])
    expect(auditsOf('run-started')).toHaveLength(1)
    expect([a.status, b.status].filter(s => s === 'claimed')).toHaveLength(1)
  })

  it('capacity frees when the lease ends: release, then the next claim succeeds', async () => {
    expect((await claimAgentTask({ taskId: 't-a1', userId: 'user-1', agentId: 'agent-claude', action: 'claim', agentEmail: CLAUDE, principal: RUNTIME })).outcome).toBe('claimed')
    expect((await claimFixallTask('t-b1', readyClaim('board-b'), { principal: RUNTIME })).status).toBe('binding-denied')
    expect((await claimAgentTask({ taskId: 't-a1', userId: 'user-1', agentId: 'agent-claude', action: 'release', agentEmail: CLAUDE, principal: RUNTIME })).outcome).toBe('released')
    expect((await claimFixallTask('t-b1', readyClaim('board-b'), { principal: RUNTIME })).status).toBe('claimed')
    expect(auditsOf('run-started')).toHaveLength(2)
  })

  it('a Doing task on the binding put there any other way still occupies capacity (fail closed)', async () => {
    db.tasks.find(t => t.id === 't-b1')!.statusRole = 'doing'
    const result = await claimFixallTask('t-a1', readyClaim('board-a'), { principal: RUNTIME })
    expect(result).toMatchObject({ status: 'binding-denied', denial: { reason: 'capacity-exhausted' } })
  })

  const stalePlan = async (change: () => void) => {
    const gate = { taskId: 't-a1', agentEmail: CLAUDE, executionBoardId: 'board-a', principal: RUNTIME }
    const advisory = await gateTaskRuntime(gate)
    if (advisory.kind !== 'bound') throw new Error('expected a bound plan')
    change() // between discovery and the fenced write
    const write = vi.fn(async (tx: any) => tx.task.updateMany({ where: { id: 't-a1', statusRole: 'ready' }, data: { statusRole: 'doing' } }))
    const outcome = await runFencedClaim({
      plan: advisory.plan, gate, actorUserId: 'user-1', operation: 'test', takesCapacity: true,
      write, started: r => r.count === 1,
    })
    return { outcome, write }
  }

  it.each([
    ['binding suspended', () => { db.bindings[0].state = 'suspended' }, 'binding-not-active'],
    ['revision bumped, not yet approved', () => { db.bindings[0].revision = 4 }, 'revision-unapproved'],
    ['agent removed', () => { db.bindings[0].allowedAgentIds = ['codex'] }, 'agent-not-allowed'],
    ['runtime replaced', () => { db.bindings[0].runtimeSubjectId = STRANGER }, 'principal-not-runtime'],
    ['credential withdrawn', () => { db.bindings[0].credentialRef = null }, 'credential-missing'],
  ])('a config change after discovery (%s) is caught under the lock: %s, no write', async (_label, change, reason) => {
    const { outcome, write } = await stalePlan(change)
    expect(outcome).toMatchObject({ kind: 'denied', denial: { reason } })
    expect(write).not.toHaveBeenCalled()
    expect(status('t-a1')).toBe('ready')
  })

  it('a board detached after discovery makes the plan stale: no write, an ordinary conflict', async () => {
    const { outcome, write } = await stalePlan(() => { db.lists.find(l => l.id === 'board-a')!.runtimeBindingId = null })
    expect(outcome).toEqual({ kind: 'stale' })
    expect(write).not.toHaveBeenCalled()
  })

  it('a task moved onto a conflicting board after discovery is refused', async () => {
    const { outcome } = await stalePlan(() => { db.tasks.find(t => t.id === 't-a1')!.listIds.push('board-x') })
    expect(outcome).toMatchObject({ kind: 'denied', denial: { reason: 'board-conflict' } })
  })

  it('a claim and a configuration change serialize on the binding row', async () => {
    const order: string[] = []
    const claim = claimFixallTask('t-a1', readyClaim('board-a'), { principal: RUNTIME }).then(r => { order.push(`claim:${r.status}`) })
    // An enrollment write takes the same row lock (it updates the binding row).
    const suspend = db.client.$transaction(async (tx: any) => {
      await tx.$queryRaw`SELECT "id" FROM "RuntimeBinding" WHERE "id" = ${'binding-1'} FOR UPDATE`
      db.bindings[0].state = 'suspended'
      order.push('suspended')
    })
    await Promise.all([claim, suspend])
    // Whichever went first, the other saw its result: never a claim admitted
    // against a binding that was already suspended.
    expect(order).toHaveLength(2)
    if (order[0] === 'suspended') expect(order[1]).toBe('claim:binding-denied')
    else expect(order[0]).toBe('claim:claimed')
  })

  it('a stale lease is fenced: after suspension the old worker can neither resume nor take new work', async () => {
    expect((await claimAgentTask({ taskId: 't-a1', userId: 'user-1', agentId: 'agent-claude', action: 'claim', agentEmail: CLAUDE, principal: RUNTIME })).outcome).toBe('claimed')
    db.bindings[0].state = 'suspended'
    const resume = await claimAgentTask({ taskId: 't-a1', userId: 'user-1', agentId: 'agent-claude', action: 'resume', agentEmail: CLAUDE, principal: RUNTIME })
    expect(resume).toMatchObject({ outcome: 'binding_denied', binding: { reason: 'binding-not-active' } })
    const next = await claimFixallTask('t-b1', readyClaim('board-b'), { principal: RUNTIME })
    expect(next).toMatchObject({ status: 'binding-denied', denial: { reason: 'binding-not-active' } })
  })
})
