/**
 * AWTD-1668 — the pure rules of runtime-binding enrollment: the lifecycle state
 * machine, which configuration changes broaden a binding (and so need
 * re-approval), input validation and the pilot limits.
 *
 * RFC docs/architecture/BUSINESS_RUNTIME_BINDING_RFC.md §6: "Scope expansion,
 * transport/runtime replacement, credential ownership changes, concurrency
 * increases and payer changes return to pending approval."
 */
import { describe, expect, it } from 'vitest'
import {
  availableActions,
  classifyBindingChange,
  isOpaqueReference,
  parseCreateInput,
  parseUpdateInput,
  pilotConfigurationProblems,
  planTransition,
  snapshotOf,
  snapshotsEqual,
  type RuntimeBindingConfig,
} from '@/lib/runtime-binding/enrollment-rules'

const BASE: RuntimeBindingConfig = {
  managementScope: 'deployment-business',
  runtimeKind: 'business-machine',
  runtimeSubjectId: 'machine:build-01',
  runtimeCustodianUserId: null,
  allowedAgentIds: ['claude'],
  transport: 'polling',
  endpointRef: null,
  credentialRef: 'cred:build-01:gen1',
  allowedRepositoryRefs: ['github:acme/app'],
  allowedBoardIds: ['board-1'],
  maxConcurrentRuns: 1,
  billingSource: 'business-provided',
  billingAccountRef: 'payer:acme',
}

const binding = (over: Partial<{ state: string; revision: number; approvedRevision: number | null; approvedBy: string | null }> = {}) => ({
  state: 'pending',
  revision: 1,
  approvedRevision: null,
  approvedBy: null,
  ...over,
})

describe('AWTD-1668 state machine', () => {
  it('pending → verified by verify', () => {
    expect(planTransition(binding(), 'verify')).toEqual({ ok: true, to: 'verified' })
  })

  it('approve keeps the binding verified and needs verification first', () => {
    expect(planTransition(binding({ state: 'verified' }), 'approve')).toEqual({ ok: true, to: 'verified' })
    expect(planTransition(binding(), 'approve')).toMatchObject({ ok: false, code: 'transition-not-allowed' })
  })

  it('an already-approved revision is not approved twice', () => {
    const approved = binding({ state: 'verified', approvedRevision: 1, approvedBy: 'admin-1' })
    expect(planTransition(approved, 'approve')).toMatchObject({ ok: false, code: 'already-approved' })
  })

  it('activate needs the CURRENT revision approved', () => {
    expect(planTransition(binding({ state: 'verified' }), 'activate')).toMatchObject({ ok: false, code: 'revision-unapproved' })
    expect(
      planTransition(binding({ state: 'verified', revision: 2, approvedRevision: 1, approvedBy: 'admin-1' }), 'activate'),
    ).toMatchObject({ ok: false, code: 'revision-unapproved' })
    expect(
      planTransition(binding({ state: 'verified', approvedRevision: 1, approvedBy: 'admin-1' }), 'activate'),
    ).toEqual({ ok: true, to: 'active' })
  })

  it('pending cannot jump straight to active', () => {
    expect(
      planTransition(binding({ approvedRevision: 1, approvedBy: 'admin-1' }), 'activate'),
    ).toMatchObject({ ok: false, code: 'transition-not-allowed' })
  })

  it('active ⇄ suspended, and resuming is an explicit activate', () => {
    const active = binding({ state: 'active', approvedRevision: 1, approvedBy: 'admin-1' })
    expect(planTransition(active, 'suspend')).toEqual({ ok: true, to: 'suspended' })
    expect(planTransition({ ...active, state: 'suspended' }, 'activate')).toEqual({ ok: true, to: 'active' })
  })

  it('revoke from any live state, and revoked is terminal', () => {
    for (const state of ['pending', 'verified', 'active', 'suspended']) {
      expect(planTransition(binding({ state }), 'revoke')).toEqual({ ok: true, to: 'revoked' })
    }
    for (const action of ['verify', 'approve', 'activate', 'suspend', 'revoke'] as const) {
      expect(planTransition(binding({ state: 'revoked' }), action).ok).toBe(false)
    }
  })

  it('availableActions offers only legal steps', () => {
    expect(availableActions(binding())).toEqual(['verify', 'revoke'])
    expect(availableActions(binding({ state: 'verified' }))).toEqual(['approve', 'revoke'])
    expect(availableActions(binding({ state: 'verified', approvedRevision: 1, approvedBy: 'a' }))).toEqual(['activate', 'revoke'])
    expect(availableActions(binding({ state: 'active', approvedRevision: 1, approvedBy: 'a' }))).toEqual(['suspend', 'revoke'])
    expect(availableActions(binding({ state: 'revoked' }))).toEqual([])
  })
})

describe('AWTD-1668 re-approval on broadening', () => {
  const broaden: Array<[string, Partial<RuntimeBindingConfig>]> = [
    ['runtimeKind', { runtimeKind: 'user-machine' }],
    ['runtimeSubjectId', { runtimeSubjectId: 'machine:other' }],
    ['runtimeCustodianUserId', { runtimeCustodianUserId: 'user-2' }],
    ['transport', { transport: 'signed-webhook' }],
    ['endpointRef', { endpointRef: 'endpoint:new' }],
    ['credentialRef', { credentialRef: 'cred:someone-else' }],
    ['allowedAgentIds', { allowedAgentIds: ['claude', 'codex'] }],
    ['allowedRepositoryRefs', { allowedRepositoryRefs: ['github:acme/app', 'github:acme/api'] }],
    ['allowedBoardIds', { allowedBoardIds: ['board-1', 'board-2'] }],
    ['maxConcurrentRuns', { maxConcurrentRuns: 2 }],
    ['billingSource', { billingSource: 'deployment-hosted' }],
    ['billingAccountRef', { billingAccountRef: 'payer:other' }],
  ]

  it.each(broaden)('%s broadens', (field, change) => {
    const result = classifyBindingChange(BASE, { ...BASE, ...change })
    expect(result.broadened).toContain(field)
    expect(result.changed).toContain(field)
  })

  it('narrowing is a change but not a broadening', () => {
    const wide = { ...BASE, allowedAgentIds: ['claude', 'codex'], allowedBoardIds: ['board-1', 'board-2'], maxConcurrentRuns: 2 }
    const result = classifyBindingChange(wide, BASE)
    expect(result.changed.sort()).toEqual(['allowedAgentIds', 'allowedBoardIds', 'maxConcurrentRuns'])
    expect(result.broadened).toEqual([])
  })

  it('reordering a set is no change at all', () => {
    const a = { ...BASE, allowedBoardIds: ['board-1', 'board-2'] }
    const b = { ...BASE, allowedBoardIds: ['board-2', 'board-1'] }
    expect(classifyBindingChange(a, b)).toEqual({ changed: [], broadened: [] })
  })

  it('swapping one board for another broadens (the new board was never approved)', () => {
    const result = classifyBindingChange(BASE, { ...BASE, allowedBoardIds: ['board-9'] })
    expect(result.broadened).toEqual(['allowedBoardIds'])
  })
})

describe('AWTD-1668 input validation', () => {
  const raw = { ...BASE }

  it('accepts a complete pilot configuration', () => {
    const parsed = parseCreateInput(raw)
    expect(parsed.ok).toBe(true)
  })

  it('refuses a personal-scope binding: phase one is deployment-business only', () => {
    const parsed = parseCreateInput({ ...raw, managementScope: 'personal' })
    expect(parsed.ok).toBe(false)
  })

  it('refuses unknown enum values and non-positive concurrency', () => {
    expect(parseCreateInput({ ...raw, transport: 'carrier-pigeon' }).ok).toBe(false)
    expect(parseCreateInput({ ...raw, maxConcurrentRuns: 0 }).ok).toBe(false)
  })

  it('refuses secret-shaped references: refs are opaque ids only', () => {
    for (const value of [
      'https://user:pass@example.com/hook',
      'sk-ant-api03-abcdef',
      'ghp_abcdefghijklmnop',
      'Bearer abc',
      'xoxb-123-456',
      'has spaces in it',
      'token?secret=1',
    ]) {
      expect(isOpaqueReference(value)).toBe(false)
      expect(parseCreateInput({ ...raw, credentialRef: value }).ok).toBe(false)
      expect(parseCreateInput({ ...raw, endpointRef: value }).ok).toBe(false)
    }
    expect(isOpaqueReference('cred:build-01:gen1')).toBe(true)
  })

  it('update input is partial but validated the same way', () => {
    expect(parseUpdateInput({ maxConcurrentRuns: 1 }).ok).toBe(true)
    expect(parseUpdateInput({ credentialRef: 'sk-live-123' }).ok).toBe(false)
    expect(parseUpdateInput({ state: 'active' }).ok).toBe(false)
  })
})

describe('AWTD-1668 pilot limits (shared with the resolver)', () => {
  it('a complete pilot configuration has no problems', () => {
    expect(pilotConfigurationProblems(BASE)).toEqual([])
  })

  it('names each limit the resolver would deny', () => {
    expect(pilotConfigurationProblems({ ...BASE, transport: 'signed-webhook' })).toContain('transport-unsupported')
    expect(pilotConfigurationProblems({ ...BASE, maxConcurrentRuns: 2 })).toContain('concurrency-invalid')
    expect(pilotConfigurationProblems({ ...BASE, credentialRef: null })).toContain('credential-missing')
    expect(pilotConfigurationProblems({ ...BASE, billingSource: 'personal-authorized' })).toContain('payer-not-business')
    expect(pilotConfigurationProblems({ ...BASE, billingAccountRef: null })).toContain('payer-missing')
    expect(pilotConfigurationProblems({ ...BASE, allowedAgentIds: [] })).toContain('agents-empty')
    expect(pilotConfigurationProblems({ ...BASE, allowedBoardIds: [] })).toContain('boards-empty')
  })
})

describe('AWTD-1668 snapshots', () => {
  it('are canonical: set order does not matter', () => {
    const a = snapshotOf({ ...BASE, allowedBoardIds: ['b', 'a'] })
    const b = snapshotOf({ ...BASE, allowedBoardIds: ['a', 'b'] })
    expect(snapshotsEqual(a, b)).toBe(true)
    expect(snapshotsEqual(a, snapshotOf({ ...BASE, maxConcurrentRuns: 2 }))).toBe(false)
  })
})
