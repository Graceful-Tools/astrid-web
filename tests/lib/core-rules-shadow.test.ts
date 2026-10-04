// @vitest-environment node
/**
 * The astrid-core shadow only watches: whatever the core does — throws, answers garbage,
 * disagrees — lib/list-permissions.ts returns its own answer and nothing escapes to the caller.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  canUserDeleteList,
  canUserEditTask,
  canUserEditTasks,
  getUserRoleInList,
  setListPermissionsShadow,
} from '@/lib/list-permissions'
import {
  SUMMARY_EVERY,
  createListPermissionsShadow,
  installListPermissionsShadow,
} from '@/lib/core-rules/list-permissions-shadow'

const owner = { id: 'user-me' }
const list = { id: 'l1', ownerId: 'user-me', privacy: 'PRIVATE', listMembers: [] }
const stranger = { id: 'user-x' }

function silentReporter() {
  return { disagreement: vi.fn(), failure: vi.fn() }
}

describe('list permissions shadow', () => {
  afterEach(() => setListPermissionsShadow(null))

  it('returns the TypeScript answer when the core throws', () => {
    const report = silentReporter()
    const shadow = createListPermissionsShadow(() => {
      throw new Error('wasm trap')
    }, report)
    setListPermissionsShadow(shadow.observe)

    expect(getUserRoleInList(owner, list)).toBe('owner')
    expect(canUserEditTasks(owner, list)).toBe(true)
    expect(canUserDeleteList(stranger, list)).toBe(false)
    expect(shadow.stats.failed).toBe(3)
    // One failure line per process, not one per call.
    expect(report.failure).toHaveBeenCalledTimes(1)
  })

  it('returns the TypeScript answer when the observer itself throws', () => {
    setListPermissionsShadow(() => {
      throw new Error('observer bug')
    })
    expect(getUserRoleInList(owner, list)).toBe('owner')
    expect(canUserEditTask(stranger, { creatorId: 'user-x' }, list)).toBe(false)
  })

  it('returns the TypeScript answer when the core disagrees, and reports it once without ids', () => {
    const report = silentReporter()
    const lyingCore = () =>
      JSON.stringify({ ok: true, value: { role: 'viewer', canEditTasks: false } })
    const shadow = createListPermissionsShadow(lyingCore, report)
    setListPermissionsShadow(shadow.observe)

    expect(getUserRoleInList(owner, list)).toBe('owner')
    expect(getUserRoleInList(owner, list)).toBe('owner')
    expect(canUserEditTasks(owner, list)).toBe(true)

    expect(shadow.stats.disagreed).toBe(3)
    expect(report.disagreement).toHaveBeenCalledTimes(2) // role once, canEditTasks once
    const logged = JSON.stringify(report.disagreement.mock.calls)
    expect(logged).not.toContain('user-me')
    expect(logged).not.toContain('l1')
  })

  it('treats an error envelope from the core as a failure, not an answer', () => {
    const report = silentReporter()
    const shadow = createListPermissionsShadow(
      () => JSON.stringify({ ok: false, error: { kind: 'badRequest' } }),
      report,
    )
    setListPermissionsShadow(shadow.observe)
    expect(getUserRoleInList(owner, list)).toBe('owner')
    expect(shadow.stats).toMatchObject({ failed: 1, compared: 0 })
  })

  it('counts one systematic disagreement once, whatever the list size', () => {
    // The dedup key used the exact member count, so one systematic divergence logged a new
    // "case" per list size until the 50-entry budget was gone, silencing everything else.
    const report = silentReporter()
    const lyingCore = () => JSON.stringify({ ok: true, value: { role: 'viewer' } })
    const shadow = createListPermissionsShadow(lyingCore, report)
    setListPermissionsShadow(shadow.observe)
    for (const n of [2, 3, 7, 40]) {
      const members = Array.from({ length: n }, (_, i) => ({ userId: `m${i}`, role: 'member' }))
      expect(getUserRoleInList(owner, { ...list, listMembers: members })).toBe('owner')
    }
    expect(shadow.stats.disagreed).toBe(4)
    expect(report.disagreement).toHaveBeenCalledTimes(1)
  })

  it('reports running totals, so a quiet log can be told apart from a skipped or failing one', () => {
    const summary = vi.fn()
    const agreeingCore = () => JSON.stringify({ ok: true, value: { role: 'owner' } })
    const shadow = createListPermissionsShadow(agreeingCore, { ...silentReporter(), summary })
    setListPermissionsShadow(shadow.observe)
    for (let i = 0; i < SUMMARY_EVERY; i++) getUserRoleInList(owner, list)
    expect(summary).toHaveBeenCalledTimes(1)
    const [details] = summary.mock.calls[0]
    expect(details.stats.compared + details.stats.skipped + details.stats.failed).toBe(SUMMARY_EVERY - 1)
    expect(JSON.stringify(details)).not.toContain('user-me')
  })

  it('skips lists whose roles web derives from the legacy members array', () => {
    const report = silentReporter()
    const shadow = createListPermissionsShadow(() => JSON.stringify({ ok: true, value: { role: 'viewer' } }), report)
    setListPermissionsShadow(shadow.observe)
    expect(getUserRoleInList(owner, { ...list, members: [{ id: 'user-x' }] })).toBe('owner')
    expect(shadow.stats.skipped).toBe(1)
    expect(report.disagreement).not.toHaveBeenCalled()
  })

  it('keeps ids out of failure reports too', () => {
    const report = silentReporter()
    const shadow = createListPermissionsShadow(() => {
      throw new Error('trap')
    }, report)
    setListPermissionsShadow(shadow.observe)
    getUserRoleInList(owner, list)
    const logged = JSON.stringify(report.failure.mock.calls)
    expect(logged).not.toContain('user-me')
    expect(logged).not.toContain('l1')
  })

  it('is not installed unless ASTRID_CORE_RULES_SHADOW=1', () => {
    expect(installListPermissionsShadow({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)).toBe(false)
  })
})
