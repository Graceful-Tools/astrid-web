/**
 * AWTD-1667 — one runtime resolver, with the explicit business binding read
 * only behind ASTRID_RUNTIME_BINDING_RESOLVER.
 *
 * RFC docs/architecture/BUSINESS_RUNTIME_BINDING_RFC.md §5 and §10, evidence
 * row 1: a board with NO binding — and every board while the flag is off —
 * must produce exactly what today's resolver produces, with no extra reads.
 * Evidence row 3: a binding that cannot be used is a VISIBLE DENIAL and never
 * falls back to the run owner's personal settings or keys.
 *
 * "Today's resolver" is called directly as the oracle: getAgentExecutionMode
 * and resolveAgentRunBilling in lib/ai/agent-execution-mode.ts, which this
 * task does not change.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockPrisma } from '@/tests/setup'
import { BRAND } from '@/lib/brand/config'
import { agentEmail } from '@/lib/brand/agent-emails'
import {
  getAgentExecutionMode,
  resolveAgentRunBilling,
  type AgentRunOwnerCandidates,
} from '@/lib/ai/agent-execution-mode'
import {
  RuntimeBindingDeniedError,
  resolveAgentRuntime,
  type RuntimeBindingRecord,
} from '@/lib/ai/runtime-binding-resolver'
import { buildAgentQueue } from '@/lib/agent-queue'
import { runtimeBindingResolverEnabled } from '@/lib/env'

vi.mock('@/lib/background', () => ({ runAfterResponse: vi.fn() }))

const FLAG = 'ASTRID_RUNTIME_BINDING_RESOLVER'
const BOARD_ID = 'board-1'
const CUSTOM_EMAIL = `buddy.oc@${BRAND.agentEmailDomain}`

// ── The legacy matrix ────────────────────────────────────────────────────────

/** Every kind of identity the current code distinguishes. */
const RESOLVER_AGENTS: Array<string | null> = [
  agentEmail('claude'),
  agentEmail('openai'),
  agentEmail('gemini'),
  agentEmail('copilot'),
  agentEmail('codex'), // local harness, forced polling
  agentEmail('muse'), // harness WITH a server executor
  agentEmail('astrid'), // first-party assistant
  agentEmail('openclaw'),
  CUSTOM_EMAIL, // OpenClaw custom agent
  'person@example.com', // not an agent
  null,
]

/** Stored settings combinations: none, each mode, junk, with and without keys. */
const SETTINGS: Array<{ label: string; mcpSettings: string | null }> = [
  { label: 'no settings', mcpSettings: null },
  { label: 'empty blob', mcpSettings: '{}' },
  { label: 'unparseable blob', mcpSettings: '{not json' },
  ...['api', 'polling', 'webhook', 'off', 'bogus'].flatMap(mode => [
    {
      label: `${mode} for every agent, no keys`,
      mcpSettings: JSON.stringify({ agentModes: everyAgent(mode) }),
    },
    {
      label: `${mode} for every agent, every key`,
      mcpSettings: JSON.stringify({ agentModes: everyAgent(mode), apiKeys: everyKey() }),
    },
  ]),
  { label: 'every key, no modes', mcpSettings: JSON.stringify({ apiKeys: everyKey() }) },
  {
    label: 'a key without its encrypted field',
    mcpSettings: JSON.stringify({ apiKeys: { claude: { iv: 'y' } } }),
  },
]

function everyAgent(mode: string) {
  return Object.fromEntries(
    ['claude', 'openai', 'gemini', 'copilot', 'codex', 'muse', 'astrid', 'openclaw', 'buddy.oc'].map(m => [m, mode]),
  )
}
function everyKey() {
  return Object.fromEntries(
    ['claude', 'openai', 'gemini', 'copilot', 'muse'].map(s => [s, { encrypted: 'x', iv: 'y' }]),
  )
}

/** Owner contexts the dispatch sites pass today. */
const OWNERS: AgentRunOwnerCandidates[] = [
  { aiAgentConfiguredBy: 'configurer', listOwnerId: 'owner', creatorId: 'creator' },
  { aiAgentConfiguredBy: '  ', listOwnerId: 'owner', creatorId: 'creator' },
  { listOwnerId: 'owner', creatorId: 'creator' },
  { creatorId: 'creator' },
  {},
]

function settingsRow(mcpSettings: string | null) {
  mockPrisma.user.findUnique.mockReset().mockImplementation(async (query: { where: Record<string, unknown> }) =>
    'id' in query.where ? { mcpSettings } : null,
  )
}

/** Every Prisma call made, by model.method, so "no extra reads" is exact. */
function prismaCalls(): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [model, methods] of Object.entries(mockPrisma)) {
    if (!methods || typeof methods !== 'object') continue
    for (const [method, fn] of Object.entries(methods as Record<string, unknown>)) {
      const calls = (fn as { mock?: { calls: unknown[] } })?.mock?.calls.length ?? 0
      if (calls) out[`${model}.${method}`] = calls
    }
  }
  return out
}
function clearPrismaCalls() {
  for (const methods of Object.values(mockPrisma)) {
    if (!methods || typeof methods !== 'object') continue
    for (const fn of Object.values(methods as Record<string, unknown>)) {
      ;(fn as { mockClear?: () => void })?.mockClear?.()
    }
  }
}

// ── A valid pilot binding, and the ways one goes wrong ───────────────────────

function binding(over: Partial<RuntimeBindingRecord> = {}): RuntimeBindingRecord {
  return {
    id: 'binding-1',
    revision: 3,
    managementScope: 'deployment-business',
    runtimeKind: 'business-machine',
    runtimeSubjectId: 'machine-1',
    allowedAgentIds: ['claude'],
    transport: 'polling',
    credentialRef: 'cred-ref-1',
    allowedRepositoryRefs: [],
    allowedBoardIds: [BOARD_ID],
    maxConcurrentRuns: 1,
    billingSource: 'business-provided',
    billingAccountRef: 'payer-1',
    state: 'active',
    approvedBy: 'admin-1',
    approvedRevision: 3,
    ...over,
  }
}

const DENIALS: Array<{ label: string; row: RuntimeBindingRecord | null; reason: string }> = [
  { label: 'missing row', row: null, reason: 'binding-missing' },
  { label: 'pending', row: binding({ state: 'pending' }), reason: 'binding-not-active' },
  { label: 'verified, not activated', row: binding({ state: 'verified' }), reason: 'binding-not-active' },
  { label: 'suspended', row: binding({ state: 'suspended' }), reason: 'binding-not-active' },
  { label: 'revoked', row: binding({ state: 'revoked' }), reason: 'binding-not-active' },
  { label: 'unknown state', row: binding({ state: 'enabled' }), reason: 'binding-not-active' },
  { label: 'never approved', row: binding({ approvedBy: null, approvedRevision: null }), reason: 'revision-unapproved' },
  { label: 'newer revision than approved', row: binding({ revision: 4 }), reason: 'revision-unapproved' },
  { label: 'personal scope', row: binding({ managementScope: 'personal' }), reason: 'scope-not-business' },
  { label: 'board not enrolled', row: binding({ allowedBoardIds: ['other-board'] }), reason: 'board-not-enrolled' },
  { label: 'no boards enrolled', row: binding({ allowedBoardIds: [] }), reason: 'board-not-enrolled' },
  { label: 'agent not allowed', row: binding({ allowedAgentIds: ['codex'] }), reason: 'agent-not-allowed' },
  { label: 'no agents allowed', row: binding({ allowedAgentIds: [] }), reason: 'agent-not-allowed' },
  { label: 'webhook transport', row: binding({ transport: 'signed-webhook' }), reason: 'transport-unsupported' },
  { label: 'concurrency zero', row: binding({ maxConcurrentRuns: 0 }), reason: 'concurrency-invalid' },
  { label: 'concurrency above pilot', row: binding({ maxConcurrentRuns: 2 }), reason: 'concurrency-invalid' },
  { label: 'no runtime subject', row: binding({ runtimeSubjectId: ' ' }), reason: 'runtime-subject-missing' },
  { label: 'no credential', row: binding({ credentialRef: null }), reason: 'credential-missing' },
  { label: 'blank credential', row: binding({ credentialRef: '  ' }), reason: 'credential-missing' },
  { label: 'personal payer', row: binding({ billingSource: 'personal-authorized' }), reason: 'payer-not-business' },
  { label: 'hosted payer', row: binding({ billingSource: 'deployment-hosted' }), reason: 'payer-not-business' },
  { label: 'no payer account', row: binding({ billingAccountRef: null }), reason: 'payer-missing' },
]

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('ASTRID_AGENT_EXECUTION_MODE_SHADOW', 'false')
  mockPrisma.runtimeBinding.findUnique.mockReset().mockResolvedValue(null)
  mockPrisma.taskList.findFirst.mockReset().mockResolvedValue(null)
  clearPrismaCalls()
})
afterEach(() => vi.unstubAllEnvs())

describe('AWTD-1667 flag', () => {
  it('is off unless explicitly "true"', () => {
    expect(runtimeBindingResolverEnabled()).toBe(false)
    for (const v of ['', 'false', '1', 'TRUE', 'yes']) {
      vi.stubEnv(FLAG, v)
      expect(runtimeBindingResolverEnabled()).toBe(false)
    }
    vi.stubEnv(FLAG, 'true')
    expect(runtimeBindingResolverEnabled()).toBe(true)
  })
})

describe('AWTD-1667 null binding and flag off: byte-identical to today', () => {
  for (const { label, mcpSettings } of SETTINGS) {
    it(`resolver output matches the legacy getter — ${label}`, async () => {
      for (const agent of RESOLVER_AGENTS) {
        for (const owners of OWNERS) {
          settingsRow(mcpSettings)
          const legacyUserId = resolveAgentRunBilling(owners).userId
          const expected = JSON.stringify({
            kind: 'legacy',
            mode: await getAgentExecutionMode(legacyUserId, agent),
            billing: resolveAgentRunBilling(owners),
          })
          const legacyCalls = prismaCalls()
          clearPrismaCalls()

          const cases: Array<{ flag: string | null; board: { id: string; runtimeBindingId?: string | null } | null }> = [
            { flag: null, board: null },
            { flag: null, board: { id: BOARD_ID, runtimeBindingId: null } },
            // Flag off: a non-null binding is NOT READ, not even queried.
            { flag: 'false', board: { id: BOARD_ID, runtimeBindingId: 'binding-1' } },
            { flag: 'true', board: null },
            { flag: 'true', board: { id: BOARD_ID, runtimeBindingId: null } },
          ]
          for (const { flag, board } of cases) {
            vi.unstubAllEnvs()
            if (flag !== null) vi.stubEnv(FLAG, flag)
            const got = await resolveAgentRuntime({ agentEmail: agent, owners, board })
            expect(JSON.stringify(got), `${agent} ${JSON.stringify(owners)} flag=${flag}`).toBe(expected)
            expect(prismaCalls()).toEqual(legacyCalls)
            clearPrismaCalls()
          }
        }
      }
    })
  }
})

describe('AWTD-1667 queue wire shape is unchanged for null bindings and flag off', () => {
  const QUEUE_AGENTS = ['claude', 'openai', 'gemini', 'copilot', 'codex', 'muse', CUSTOM_EMAIL]
  const AGENT_ROW = (email: string) =>
    email === CUSTOM_EMAIL
      ? { id: 'user-1', name: 'Buddy', isAIAgent: true, aiAgentType: 'openclaw_worker', aiAgentConfig: null }
      : { id: 'agent-row', name: 'Agent', isAIAgent: true, aiAgentType: null, aiAgentConfig: null }
  const readyTask = {
    id: 'task-1',
    identifier: 'AWTD-1',
    title: 'Fix the thing',
    description: null,
    priority: 2,
    dueDateTime: null,
    isAllDay: false,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    assigneeId: 'agent-row',
    lists: [{ id: BOARD_ID, name: 'Board', githubRepositoryId: 'owner/repo' }],
  }

  function queueRows(mcpSettings: string | null, email: string, tasks: unknown[]) {
    mockPrisma.user.findUnique.mockReset().mockImplementation(async (query: { where: Record<string, unknown> }) =>
      'email' in query.where ? AGENT_ROW(email) : { mcpSettings },
    )
    mockPrisma.task.findMany.mockReset().mockImplementation(async (query: { select?: Record<string, unknown> }) =>
      query.select && 'comments' in query.select ? [] : tasks,
    )
  }

  for (const { label, mcpSettings } of SETTINGS) {
    it(`identical JSON and no extra reads with the flag off — ${label}`, async () => {
      for (const agent of QUEUE_AGENTS) {
        const email = agent.includes('@') ? agent : agentEmail(agent)
        for (const listId of [null, BOARD_ID]) {
          for (const tasks of [[], [readyTask]]) {
            queueRows(mcpSettings, email, tasks)
            const options = { agent, userId: 'user-1', listId, includeChat: true }

            const unset = JSON.stringify(await buildAgentQueue(options))
            const unsetCalls = prismaCalls()
            expect(unsetCalls['taskList.findFirst']).toBeUndefined()
            expect(unsetCalls['runtimeBinding.findUnique']).toBeUndefined()
            clearPrismaCalls()

            vi.stubEnv(FLAG, 'false')
            expect(JSON.stringify(await buildAgentQueue(options))).toBe(unset)
            expect(prismaCalls()).toEqual(unsetCalls)
            clearPrismaCalls()

            // Flag on, board has no binding: same bytes; at most the one board read.
            vi.stubEnv(FLAG, 'true')
            mockPrisma.taskList.findFirst.mockResolvedValue(listId ? { runtimeBindingId: null } : null)
            expect(JSON.stringify(await buildAgentQueue(options))).toBe(unset)
            const onCalls = prismaCalls()
            expect(onCalls['runtimeBinding.findUnique']).toBeUndefined()
            const { ['taskList.findFirst']: boardReads = 0, ...rest } = onCalls
            expect(boardReads).toBe(listId ? 1 : 0)
            expect(rest).toEqual(unsetCalls)
            clearPrismaCalls()
            vi.unstubAllEnvs()
            vi.stubEnv('ASTRID_AGENT_EXECUTION_MODE_SHADOW', 'false')
            mockPrisma.taskList.findFirst.mockReset().mockResolvedValue(null)
          }
        }
      }
    })
  }

  it('looks the board up only within what the caller can see', async () => {
    queueRows(null, agentEmail('claude'), [])
    vi.stubEnv(FLAG, 'true')
    await buildAgentQueue({ agent: 'claude', userId: 'user-1', listId: BOARD_ID })
    expect(mockPrisma.taskList.findFirst).toHaveBeenCalledWith({
      where: {
        id: BOARD_ID,
        OR: [{ ownerId: 'user-1' }, { listMembers: { some: { userId: 'user-1' } } }, { privacy: 'PUBLIC' }],
      },
      select: { runtimeBindingId: true },
    })
  })
})

describe('AWTD-1667 a non-null binding that cannot be used is a visible denial', () => {
  const board = { id: BOARD_ID, runtimeBindingId: 'binding-1' }
  // A personal setup that WOULD run on the API with a stored key, so any
  // fall-back to it would be visible.
  const personal = JSON.stringify({ agentModes: { claude: 'api' }, apiKeys: everyKey() })

  for (const { label, row, reason } of DENIALS) {
    it(`denies ${label} (${reason}) without reading personal settings`, async () => {
      vi.stubEnv(FLAG, 'true')
      settingsRow(personal)
      mockPrisma.runtimeBinding.findUnique.mockResolvedValue(row)

      const got = await resolveAgentRuntime({
        agentEmail: agentEmail('claude'),
        owners: { aiAgentConfiguredBy: 'configurer' },
        board,
      })

      expect(got).toMatchObject({ kind: 'denied', bindingId: 'binding-1', boardId: BOARD_ID, reason })
      expect(got).not.toHaveProperty('mode')
      expect(got).not.toHaveProperty('billing')
      expect(JSON.stringify(got)).not.toContain('cred-ref-1')
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled()
      expect(mockPrisma.runtimeBinding.findUnique).toHaveBeenCalledOnce()
    })
  }

  it('denies, rather than falling back, when the binding lookup itself fails', async () => {
    vi.stubEnv(FLAG, 'true')
    settingsRow(personal)
    mockPrisma.runtimeBinding.findUnique.mockRejectedValue(new Error('connection reset'))
    const got = await resolveAgentRuntime({ agentEmail: agentEmail('claude'), owners: {}, board })
    expect(got).toMatchObject({ kind: 'denied', reason: 'binding-lookup-failed' })
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled()
  })

  it('surfaces the denial from the queue as a typed error, not an empty or personal queue', async () => {
    vi.stubEnv(FLAG, 'true')
    mockPrisma.user.findUnique.mockReset().mockImplementation(async (query: { where: Record<string, unknown> }) =>
      'email' in query.where ? { id: 'agent-row', name: 'Claude', isAIAgent: true, aiAgentType: null, aiAgentConfig: null } : { mcpSettings: personal },
    )
    mockPrisma.taskList.findFirst.mockResolvedValue({ runtimeBindingId: 'binding-1' })
    mockPrisma.runtimeBinding.findUnique.mockResolvedValue(binding({ state: 'suspended' }))

    const error = await buildAgentQueue({ agent: 'claude', userId: 'user-1', listId: BOARD_ID }).catch(e => e)
    expect(error).toBeInstanceOf(RuntimeBindingDeniedError)
    expect(error).toMatchObject({ reason: 'binding-not-active', bindingId: 'binding-1', boardId: BOARD_ID })
    expect(mockPrisma.task.findMany).not.toHaveBeenCalled()
    // Personal settings were never consulted.
    expect(mockPrisma.user.findUnique.mock.calls.some(([q]) => 'id' in q.where)).toBe(false)
  })
})

describe('AWTD-1667 an active, valid pilot binding resolves through the binding', () => {
  it('returns a polling plan with the business payer and never reads personal settings', async () => {
    vi.stubEnv(FLAG, 'true')
    settingsRow(JSON.stringify({ agentModes: { claude: 'api' }, apiKeys: everyKey() }))
    mockPrisma.runtimeBinding.findUnique.mockResolvedValue(binding())

    const got = await resolveAgentRuntime({
      agentEmail: agentEmail('claude'),
      owners: { aiAgentConfiguredBy: 'configurer' },
      board: { id: BOARD_ID, runtimeBindingId: 'binding-1' },
    })

    expect(got).toEqual({
      kind: 'bound',
      mode: 'polling',
      plan: {
        bindingId: 'binding-1',
        revision: 3,
        boardId: BOARD_ID,
        agentMailbox: 'claude',
        runtimeKind: 'business-machine',
        runtimeSubjectId: 'machine-1',
        transport: 'polling',
        credentialRef: 'cred-ref-1',
        maxConcurrentRuns: 1,
        payer: { source: 'business-provided', accountRef: 'payer-1' },
      },
    })
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled()
  })

  it('adds only the binding identity to the queue — never the credential reference', async () => {
    vi.stubEnv(FLAG, 'true')
    mockPrisma.user.findUnique.mockReset().mockImplementation(async (query: { where: Record<string, unknown> }) =>
      'email' in query.where ? { id: 'agent-row', name: 'Claude', isAIAgent: true, aiAgentType: null, aiAgentConfig: null } : { mcpSettings: null },
    )
    mockPrisma.task.findMany.mockReset().mockResolvedValue([])
    mockPrisma.taskList.findFirst.mockResolvedValue({ runtimeBindingId: 'binding-1' })
    mockPrisma.runtimeBinding.findUnique.mockResolvedValue(binding())

    const result = await buildAgentQueue({ agent: 'claude', userId: 'user-1', listId: BOARD_ID })
    expect(result.mode).toBe('polling')
    expect(result.runtimeBinding).toEqual({ id: 'binding-1', revision: 3 })
    const wire = JSON.stringify(result)
    expect(wire).not.toContain('cred-ref-1')
    expect(wire).not.toContain('payer-1')
    expect(mockPrisma.user.findUnique.mock.calls.some(([q]) => 'id' in q.where)).toBe(false)
  })
})
