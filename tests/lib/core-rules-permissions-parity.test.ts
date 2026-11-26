// @vitest-environment node
/**
 * lib/list-permissions.ts decided by astrid-core (AWTD-1061), against the permissions contract.
 *
 * Every case in the permissions fixture (vendored at the pinned core revision; including the
 * project roles, the status-list cascade and the legacy admins/members arrays) goes through the
 * web's PUBLIC functions with the vendored WebAssembly core installed as the server installs it,
 * and must give the fixture's answers, every one answered by the core itself.
 *
 * Since ADEV-304 (step B) the core is the only rule and canonical for it: the fixture is generated
 * in astrid-core (`cargo xtask gen-core-contracts`) and copied by scripts/build-astrid-rules.sh. A
 * behaviour change starts there. When this fails, web is sending the core something it reads
 * differently, or the pin moved without this repo noticing.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  canUserDeleteList,
  canUserEditTask,
  canUserEditTasks,
  canUserManageList,
  canUserManageMembers,
  getUserRoleInList,
  hasExplicitListRole,
  setListPermissionsCore,
} from '@/lib/list-permissions'
import { coreRequestFor, createListPermissionsCore } from '@/lib/core-rules/list-permissions-core'
import { loadCoreRulesFrom } from '@/lib/core-rules/wasm'
import { installTestListPermissionsCore } from '@/tests/helpers/list-permissions-core'

const PACKAGE_DIR = path.join(process.cwd(), 'packages', 'astrid-rules')

type FixtureList = Parameters<typeof getUserRoleInList>[1]

interface Fixture {
  userId: string
  ownTaskCreatorId: string
  othersTaskCreatorId: string
  cases: Array<{
    name: string
    list: FixtureList
    expected: {
      role: string | null
      canViewList: boolean
      canEditTasks: boolean
      canEditOwnTask: boolean
      canEditOthersTask: boolean
      hasExplicitListRole: boolean
      canManageList: boolean
      canManageMembers: boolean
      canDeleteList: boolean
    }
  }>
}

const fixture = JSON.parse(
  readFileSync(path.join(PACKAGE_DIR, 'fixtures', 'permissions.json'), 'utf8'),
) as Fixture
const core = loadCoreRulesFrom(PACKAGE_DIR)

/** Every public decision for the fixture's user, in the fixture's own vocabulary. */
function answersFor(list: FixtureList) {
  const user = { id: fixture.userId }
  return {
    role: getUserRoleInList(user, list),
    canViewList: getUserRoleInList(user, list) !== null,
    canEditTasks: canUserEditTasks(user, list),
    canEditOwnTask: canUserEditTask(user, { creatorId: fixture.ownTaskCreatorId }, list),
    canEditOthersTask: canUserEditTask(user, { creatorId: fixture.othersTaskCreatorId }, list),
    hasExplicitListRole: hasExplicitListRole(user, list),
    canManageList: canUserManageList(user, list),
    canManageMembers: canUserManageMembers(user, list),
    canDeleteList: canUserDeleteList(user, list),
  }
}

/** Public function calls answersFor makes per case — each one a question put to the core. */
const DECISIONS_PER_CASE = 9

const cases = fixture.cases.map((c) => [c.name, c] as const)

afterEach(() => installTestListPermissionsCore())

describe('the permissions fixture at the pinned core revision', () => {
  it('loads the vendored build at a pinned revision', () => {
    expect(core.revision).toMatch(/^[0-9a-f]{40}$/)
  })

  it('covers the server-only branches the core learned in AWTD-1061', () => {
    // Without these the cutover would be deciding project and legacy-array lists untested.
    const has = (pick: (list: FixtureList) => unknown) => fixture.cases.some((c) => pick(c.list))
    expect(has((l) => l.project)).toBe(true)
    expect(has((l) => l.admins?.length)).toBe(true)
    expect(has((l) => l.members?.length)).toBe(true)
    expect(has((l) => l.listType === 'status' && l.project?.lists?.length)).toBe(true)
    expect(fixture.cases.length).toBeGreaterThanOrEqual(68)
  })

  it('records that project owners and admins outrank a plain list membership (2026-10-04)', () => {
    // At a core revision from before the decision these cases say "member": the pin and the
    // fixture must move together.
    const outranked = fixture.cases.filter(
      (c) =>
        c.list.listMembers?.some((m) => m.userId === fixture.userId && m.role?.toLowerCase() !== 'admin') &&
        (c.list.project?.ownerId === fixture.userId ||
          c.list.project?.members?.some((m) => m.userId === fixture.userId && m.role?.toLowerCase() === 'admin')),
    )
    expect(outranked.length).toBeGreaterThanOrEqual(3)
    for (const c of outranked) expect(c.expected.role).toBe('admin')
  })

  it('puts every case to the core — none is outside its domain any more', () => {
    for (const { list } of fixture.cases) {
      const built = coreRequestFor({
        decision: 'role',
        user: { id: fixture.userId },
        list,
      })
      expect(built).not.toHaveProperty('skip')
    }
  })
})

describe('the public functions with astrid-core deciding, as the server runs them', () => {
  it.each(cases)('%s', (_name, { list, expected }) => {
    const reports: unknown[] = []
    const decider = createListPermissionsCore(core.runJson, {
      failure: (d) => reports.push(d),
    })
    setListPermissionsCore(decider.decide)

    expect(answersFor(list)).toEqual(expected)
    // The core answered every question itself — no fallback, no skip — with the fixture's answers.
    expect(reports).toEqual([])
    expect(decider.stats).toEqual({ answered: DECISIONS_PER_CASE, skipped: 0, failed: 0 })
  })

  it('nobody signed in has no access in the core either', () => {
    const reply = JSON.parse(core.runJson(JSON.stringify({ kind: 'listAccess', list: fixture.cases[0].list })))
    expect(reply.ok).toBe(true)
    expect(reply.value.role).toBeNull()
    expect(reply.value.canView).toBe(false)
  })
})
