// @vitest-environment node
/**
 * astrid-core decides list permissions on the server (AWTD-1061) — and fails closed. Since ADEV-304
 * there is no TypeScript rule: whatever the core does short of answering (cannot load, throws,
 * answers garbage or an error envelope), the public functions in lib/list-permissions.ts REFUSE
 * (no role, every predicate false), and nothing escapes to the caller.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  canEditListSettings,
  canUserDeleteList,
  canUserEditTask,
  canUserEditTasks,
  canUserManageList,
  getUserRoleInList,
  setListPermissionsCore,
} from '@/lib/list-permissions'
import {
  SUMMARY_EVERY,
  coreRequestFor,
  coreRulesModeFrom,
  createListPermissionsCore,
  installListPermissionsCore,
  listPermissionsCoreStatus,
} from '@/lib/core-rules/list-permissions-core'
import { installTestListPermissionsCore } from '@/tests/helpers/list-permissions-core'

const owner = { id: 'user-me' }
const list = { id: 'l1', ownerId: 'user-me', privacy: 'PRIVATE', listMembers: [] }
const stranger = { id: 'user-x' }

function silentReporter() {
  return { failure: vi.fn() }
}

/** A core that answers `value` to every question. */
const answering = (value: Record<string, unknown>) => vi.fn(() => JSON.stringify({ ok: true, value }))

afterEach(() => {
  installTestListPermissionsCore()
  vi.doUnmock('@/lib/core-rules/wasm')
  vi.resetModules()
})

describe('the core decides', () => {
  it('returns the core answer, not the TypeScript one, in decide mode', () => {
    // A core that answers differently is the only way to see whose answer came back.
    const report = silentReporter()
    const decider = createListPermissionsCore(answering({ role: 'viewer', canManage: false }), report)
    setListPermissionsCore(decider.decide)

    expect(getUserRoleInList(owner, list)).toBe('viewer')
    expect(canUserManageList(owner, list)).toBe(false)
    // Functions built on the decided ones follow the core too.
    expect(canEditListSettings(list, owner.id)).toBe(false)
    // No comparison (AWTD-1608): answered, and nothing reported.
    expect(decider.stats).toEqual({ answered: 3, skipped: 0, failed: 0 })
    expect(report.failure).not.toHaveBeenCalled()
  })

  it('a decider built in shadow mode does not ask the core, so the check is refused (ADEV-304)', () => {
    // installListPermissionsCore never builds one since ADEV-304; the decider still accepts the mode.
    const runJson = answering({ role: 'viewer' })
    const decider = createListPermissionsCore(runJson, silentReporter(), { mode: 'shadow' })
    setListPermissionsCore(decider.decide)

    expect(getUserRoleInList(owner, list)).toBeNull()
    expect(runJson).not.toHaveBeenCalled()
    expect(decider.stats).toEqual({ answered: 0, skipped: 1, failed: 0 })
  })

  it('reports running totals, so a quiet log can be told apart from a failing one', () => {
    const summary = vi.fn()
    const decider = createListPermissionsCore(answering({ role: 'owner' }), { ...silentReporter(), summary })
    setListPermissionsCore(decider.decide)
    for (let i = 0; i < SUMMARY_EVERY; i++) getUserRoleInList(owner, list)
    expect(summary).toHaveBeenCalledTimes(1)
    const [details] = summary.mock.calls[0]
    expect(details.stats.answered).toBe(SUMMARY_EVERY - 1)
    expect(JSON.stringify(details)).not.toContain('user-me')
  })
})

describe('ADEV-304: a core that cannot answer is a refusal, never a guess', () => {
  it('when the core throws — and stops asking it for the rest of the process', () => {
    const report = silentReporter()
    const runJson = vi.fn(() => {
      throw new Error('wasm trap')
    })
    const decider = createListPermissionsCore(runJson, report)
    setListPermissionsCore(decider.decide)

    expect(getUserRoleInList(owner, list)).toBeNull()
    expect(canUserEditTasks(owner, list)).toBe(false)
    expect(canUserDeleteList(stranger, list)).toBe(false)
    expect(runJson).toHaveBeenCalledTimes(1)
    expect(decider.stats.failed).toBe(3)
    // One failure line per process, not one per call.
    expect(report.failure).toHaveBeenCalledTimes(1)
  })

  it('when the decider itself throws', () => {
    setListPermissionsCore(() => {
      throw new Error('decider bug')
    })
    expect(getUserRoleInList(owner, list)).toBeNull()
    expect(canUserEditTask(stranger, { creatorId: 'user-x' }, list)).toBe(false)
  })

  it('when the decider answers something that is not an answer', () => {
    setListPermissionsCore((q) => (q.decision === 'role' ? 'superuser' : ('yes' as unknown as boolean)))
    expect(getUserRoleInList(owner, list)).toBeNull()
    expect(canUserManageList(owner, list)).toBe(false)
    expect(canUserManageList(stranger, list)).toBe(false)
  })

  it('when the core sends an error envelope — for that question only', () => {
    const report = silentReporter()
    const runJson = vi.fn(() => JSON.stringify({ ok: false, error: { kind: 'badRequest' } }))
    const decider = createListPermissionsCore(runJson, report)
    setListPermissionsCore(decider.decide)
    expect(getUserRoleInList(owner, list)).toBeNull()
    expect(getUserRoleInList(owner, list)).toBeNull()
    expect(runJson).toHaveBeenCalledTimes(2) // not switched off: the next question may be fine
    expect(decider.stats).toMatchObject({ failed: 2, answered: 0 })
    expect(report.failure).toHaveBeenCalledTimes(1)
  })

  it('when the core answers garbage or the wrong type', () => {
    for (const reply of ['not json', JSON.stringify({ ok: true, value: { role: 'superuser' } }), JSON.stringify({ ok: true, value: { canManage: 'yes' } })]) {
      const decider = createListPermissionsCore(() => reply, silentReporter())
      setListPermissionsCore(decider.decide)
      expect(getUserRoleInList(owner, list)).toBeNull()
      expect(canUserManageList(owner, list)).toBe(false)
      expect(decider.stats.failed).toBe(2)
    }
  })

  it('when there is no signed-in id — the core is not asked', () => {
    const runJson = vi.fn(() => JSON.stringify({ ok: true, value: { role: 'owner' } }))
    const decider = createListPermissionsCore(runJson, silentReporter())
    setListPermissionsCore(decider.decide)
    expect(getUserRoleInList({ id: '' }, { ...list, ownerId: 'someone' })).toBeNull()
    expect(runJson).not.toHaveBeenCalled()
    expect(decider.stats.skipped).toBe(1)
  })

  it('keeps ids out of failure reports', () => {
    const report = silentReporter()
    const decider = createListPermissionsCore(() => {
      throw new Error('trap')
    }, report)
    setListPermissionsCore(decider.decide)
    getUserRoleInList(owner, list)
    const logged = JSON.stringify(report.failure.mock.calls)
    expect(logged).not.toContain('user-me')
    expect(logged).not.toContain('l1')
  })
})

describe('what the core is sent', () => {
  it('carries the project, the status-list siblings and the legacy arrays', () => {
    const built = coreRequestFor({
      decision: 'role',
      user: owner,
      list: {
        ownerId: 'o',
        listType: 'status',
        admins: [{ id: 'a' }],
        members: [{ id: 'm' }],
        project: {
          id: 'p',
          ownerId: 'po',
          members: [{ userId: 'pm', role: 'ADMIN' }],
          lists: [{ id: 'd', listMembers: [{ userId: 'user-me' }] }],
        },
      },
    })
    expect(built).toEqual({
      request: expect.objectContaining({
        list: expect.objectContaining({
          listType: 'status',
          admins: [{ id: 'a' }],
          members: [{ id: 'm' }],
          project: {
            ownerId: 'po',
            members: [{ userId: 'pm', role: 'ADMIN' }],
            lists: [{ listMembers: [{ userId: 'user-me' }] }],
          },
        }),
      }),
    })
  })

  it('drops entries that could never match anyone, rather than failing the request', () => {
    const built = coreRequestFor({
      decision: 'role',
      user: owner,
      list: {
        ownerId: 'o',
        admins: [null as unknown as { id: string }, { id: 'a' }],
        project: { lists: [{ id: 'd', listMembers: null }, { id: 'e' }] },
      },
    }) as { request: { list: Record<string, unknown> } }
    expect(built.request.list.admins).toEqual([{ id: 'a' }])
    expect(built.request.list.project).toEqual({ ownerId: null, members: [], lists: [{ listMembers: [] }, { listMembers: [] }] })
    expect(built.request.list).not.toHaveProperty('members')
  })
})

describe('installing the core', () => {
  it('reads ASTRID_CORE_RULES: decide by default; shadow and off (still the other rules\' rollbacks)', () => {
    expect(coreRulesModeFrom(undefined)).toBe('decide')
    expect(coreRulesModeFrom('on')).toBe('decide')
    expect(coreRulesModeFrom('shadow')).toBe('shadow')
    for (const off of ['off', 'OFF', '0', 'false']) {
      expect(coreRulesModeFrom(off)).toBe('off')
    }
  })

  it('installs the vendored core, which then decides, and says so in its status', () => {
    expect(installListPermissionsCore(undefined)).toBe(true)
    expect(listPermissionsCoreStatus()).toMatchObject({ mode: 'decide', loaded: true, revision: expect.stringMatching(/^[0-9a-f]{40}$/) })

    // A project-owner case the TypeScript and the core both answer 'admin' — through the core.
    expect(getUserRoleInList(owner, { ownerId: 'o', project: { ownerId: 'user-me' } })).toBe('admin')
    expect(listPermissionsCoreStatus()?.stats).toEqual({ answered: 1, skipped: 0, failed: 0 })
  })

  it('ADEV-304: ASTRID_CORE_RULES=off does not switch list permissions off: the core still decides', () => {
    setListPermissionsCore(() => 'viewer')
    expect(installListPermissionsCore('off')).toBe(true)
    expect(getUserRoleInList(owner, list)).toBe('owner')
    expect(listPermissionsCoreStatus()).toMatchObject({ mode: 'decide', loaded: true })
  })

  it('ADEV-304: refuses every check when the core cannot load, and reports it', async () => {
    vi.resetModules()
    vi.doMock('@/lib/core-rules/wasm', () => ({ loadCoreRules: () => null }))
    const fresh = await import('@/lib/core-rules/list-permissions-core')

    expect(fresh.installListPermissionsCore(undefined)).toBe(false)
    expect(fresh.listPermissionsCoreStatus()).toMatchObject({ mode: 'decide', loaded: false, revision: null })
    expect(getUserRoleInList(owner, list)).toBeNull()
    expect(canUserDeleteList(owner, list)).toBe(false)
    expect(() => fresh.assertListPermissionsCoreInstalled()).toThrow(/astrid-core/)
  })
})
