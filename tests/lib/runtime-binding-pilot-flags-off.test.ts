/**
 * AWTD-1669 — with the runtime-binding pilot OFF, every path it touches is
 * byte-identical to before: the same Prisma calls with the same arguments, the
 * same results, and no binding column, binding row, lock or audit row read or
 * written — even when the task's board carries a binding.
 *
 * "Off" is every combination except both flags exactly "true": unset, each flag
 * alone (a shared deployment that enabled only the resolver for #803 must not
 * start hiding boards or fencing claims), and explicit "false". The pattern is
 * the resolver PR's suite (tests/lib/runtime-binding-resolver.test.ts): the
 * unset run is the oracle and every other combination must match it exactly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockPrisma } from '@/tests/setup'
import { agentEmail } from '@/lib/brand/agent-emails'
import { claimFixallTask } from '@/services/fixall-claim.service'
import { claimAgentTask } from '@/services/agent-task-claim.service'
import { buildAgentQueue } from '@/lib/agent-queue'
import { boundDispatchHold, gateTaskRuntime } from '@/lib/runtime-binding/task-runtime'
import type { FixallClaimRequest } from '@/lib/fixall-claim'

vi.mock('@/lib/background', () => ({ runAfterResponse: vi.fn() }))

const RESOLVER = 'ASTRID_RUNTIME_BINDING_RESOLVER'
const SINGLE = 'ASTRID_RUNTIME_BINDING_SINGLE_BUSINESS'
const CLAUDE = agentEmail('claude')

const OFF_COMBINATIONS: Array<[string, Record<string, string | undefined>]> = [
  ['both unset', {}],
  ['resolver only', { [RESOLVER]: 'true' }],
  ['single-business only', { [SINGLE]: 'true' }],
  ['both "false"', { [RESOLVER]: 'false', [SINGLE]: 'false' }],
  ['resolver "true", single-business "false"', { [RESOLVER]: 'true', [SINGLE]: 'false' }],
  ['resolver "TRUE" (not exactly true)', { [RESOLVER]: 'TRUE', [SINGLE]: 'true' }],
]

/** Every Prisma call, in order, with its arguments: the byte-identical record. */
function prismaTrace(): string {
  const calls: Array<[number, string, unknown]> = []
  for (const [model, methods] of Object.entries(mockPrisma)) {
    if (!methods || typeof methods !== 'object') continue
    for (const [method, fn] of Object.entries(methods as Record<string, unknown>)) {
      const mock = (fn as { mock?: { calls: unknown[][]; invocationCallOrder: number[] } })?.mock
      mock?.calls.forEach((args, i) => calls.push([mock.invocationCallOrder[i], `${model}.${method}`, args]))
    }
  }
  return JSON.stringify(calls.sort((a, b) => a[0] - b[0]).map(([, name, args]) => [name, args]))
}
const touchedBinding = (trace: string) =>
  /runtimeBinding|runtimeBindingId|\$queryRaw|\$transaction/.test(trace)

function arrangeData() {
  // The board IS bound. With the pilot off nothing may notice.
  mockPrisma.user.findUnique.mockImplementation(async (q: { where: { email?: string } }) =>
    q.where.email === CLAUDE
      ? { id: 'agent-claude', email: CLAUDE, name: 'Claude', isAIAgent: true, isActive: true, aiAgentType: 'claude_agent', aiAgentConfig: null }
      : { mcpSettings: null },
  )
  mockPrisma.task.findUnique.mockImplementation(async () => ({
    comments: [],
    lists: [{ id: 'board-a', runtimeBindingId: 'binding-1' }],
  }))
  ;(mockPrisma.task as Record<string, any>).updateMany = vi.fn(async () => ({ count: 1 }))
  mockPrisma.task.findFirst.mockResolvedValue({
    id: 't-1', statusRole: 'ready', completed: false, assigneeId: null, assigneeIds: [], updatedAt: new Date('2026-11-01T00:00:00Z'),
  })
  ;(mockPrisma.task as Record<string, any>).updateManyAndReturn = vi.fn(async () => [{
    id: 't-1', statusRole: 'doing', completed: false, assigneeId: 'agent-claude', assigneeIds: ['agent-claude'], updatedAt: new Date('2026-11-01T00:00:01Z'),
  }])
  mockPrisma.task.findMany.mockResolvedValue([])
  mockPrisma.task.count.mockResolvedValue(0)
  mockPrisma.taskList.findFirst.mockResolvedValue({ runtimeBindingId: null })
  mockPrisma.runtimeBinding.findUnique.mockResolvedValue({ id: 'binding-1', state: 'active' })
}

async function runWith(env: Record<string, string | undefined>, scenario: () => Promise<unknown>) {
  vi.unstubAllEnvs()
  vi.stubEnv(RESOLVER, '')
  vi.stubEnv(SINGLE, '')
  delete process.env[RESOLVER]
  delete process.env[SINGLE]
  for (const [key, value] of Object.entries(env)) if (value !== undefined) vi.stubEnv(key, value)
  vi.clearAllMocks()
  arrangeData()
  const result = await scenario()
  return { result: JSON.stringify(result), trace: prismaTrace() }
}

const SCENARIOS: Array<[string, () => Promise<unknown>]> = [
  ['claim-fixall ready', () => claimFixallTask('t-1', { action: 'ready', commentWatermark: null, agent: 'claude', listId: 'board-a' } as FixallClaimRequest, { principal: 'astrid_client_x', actorUserId: 'user-1' })],
  ['claim-fixall pause', () => claimFixallTask('t-1', { action: 'pause', commentWatermark: '2026-11-01T00:00:00.000Z', taskVersion: '2026-11-01T00:00:00.000Z', agent: 'claude', listId: 'board-a' } as FixallClaimRequest, { principal: null })],
  ['v1 claim', () => claimAgentTask({ taskId: 't-1', userId: 'user-1', agentId: 'agent-claude', action: 'claim', agentEmail: CLAUDE, principal: 'astrid_client_x' })],
  ['queue without listId', () => buildAgentQueue({ agent: 'claude', userId: 'user-1', runtimePrincipal: 'astrid_client_x' })],
  ['queue with a stranger and no client', () => buildAgentQueue({ agent: 'claude', userId: 'user-1', runtimePrincipal: null })],
  ['dispatch hold', () => boundDispatchHold({ taskId: 't-1', agentEmail: CLAUDE, operation: 'assignment-dispatch' })],
  ['task gate', () => gateTaskRuntime({ taskId: 't-1', agentEmail: CLAUDE, principal: 'astrid_client_x' })],
]

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-14T12:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('AWTD-1669 — pilot off is byte-identical', () => {
  it.each(SCENARIOS)('%s: identical result and Prisma trace under every off combination', async (_label, scenario) => {
    const oracle = await runWith({}, scenario)
    expect(touchedBinding(oracle.trace)).toBe(false)
    for (const [, env] of OFF_COMBINATIONS) {
      const run = await runWith(env, scenario)
      expect(run.result).toBe(oracle.result)
      // The resolver-only queue reads a named board's binding (AWTD-1667) —
      // none of these scenarios names one, so every trace must match exactly.
      expect(run.trace).toBe(oracle.trace)
    }
  })

  it('the dispatch hold and the task gate answer legacy without a single read', async () => {
    for (const [, env] of OFF_COMBINATIONS) {
      const hold = await runWith(env, () => boundDispatchHold({ taskId: 't-1', agentEmail: CLAUDE, operation: 'x' }))
      expect(hold.result).toBe('null')
      expect(hold.trace).toBe('[]')
      const gate = await runWith(env, () => gateTaskRuntime({ taskId: 't-1', agentEmail: CLAUDE }))
      expect(gate.result).toBe(JSON.stringify({ kind: 'legacy' }))
      expect(gate.trace).toBe('[]')
    }
  })

  it('the resolver-only queue with a named board keeps #803 behaviour: no discovery filter, no principal check', async () => {
    const run = await runWith({ [RESOLVER]: 'true' }, () =>
      buildAgentQueue({ agent: 'claude', userId: 'user-1', listId: 'board-a', runtimePrincipal: null }))
    expect(run.trace).not.toContain('runtimeBinding.findMany')
    expect(run.trace).not.toContain('"none"')
    expect(run.trace).not.toContain('runtimeBindingAuditEvent')
  })

  it('pilot ON changes the claim trace (the oracle above is not vacuous)', async () => {
    const off = await runWith({}, SCENARIOS[0][1])
    const on = await runWith({ [RESOLVER]: 'true', [SINGLE]: 'true' }, SCENARIOS[0][1])
    expect(on.trace).not.toBe(off.trace)
    expect(touchedBinding(on.trace)).toBe(true)
  })
})
