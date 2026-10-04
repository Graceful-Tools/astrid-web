// @vitest-environment node
/**
 * Parity proof for lib/list-permissions.ts decided by astrid-core (AWTD-1061).
 *
 * Every case in the permissions contract fixture — generated from this repo's own
 * list-permissions.ts, vendored at the pinned core revision, and since AWTD-1061 including the
 * project roles, the status-list cascade and the legacy admins/members arrays — goes through the
 * web's PUBLIC functions twice: once with the TypeScript deciding (the browser, and the server's
 * fallback), once with the vendored WebAssembly core installed as the server installs it. Both
 * must give the fixture's answers, and the core must have answered every question itself.
 *
 * When this fails after a rule change, the browser and the server disagree: change
 * list-permissions.ts, regenerate astrid-core's fixture, port it, and rebuild packages/astrid-rules.
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

afterEach(() => setListPermissionsCore(null))

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
    expect(fixture.cases.length).toBeGreaterThanOrEqual(64)
  })

  it('puts every case to the core — none is outside its domain any more', () => {
    for (const { list } of fixture.cases) {
      const built = coreRequestFor({
        decision: 'role',
        user: { id: fixture.userId },
        list,
        typescriptAnswer: null,
      })
      expect(built).not.toHaveProperty('skip')
    }
  })
})

describe('the TypeScript rules alone (the browser, and the server fallback)', () => {
  it.each(cases)('%s', (_name, { list, expected }) => {
    expect(answersFor(list)).toEqual(expected)
  })
})

describe('the public functions with astrid-core deciding, as the server runs them', () => {
  it.each(cases)('%s', (_name, { list, expected }) => {
    const reports: unknown[] = []
    const decider = createListPermissionsCore(core.runJson, {
      disagreement: (d) => reports.push(d),
      failure: (d) => reports.push(d),
    })
    setListPermissionsCore(decider.decide)

    expect(answersFor(list)).toEqual(expected)
    // The core answered every question itself — no fallback, no skip — and agreed.
    expect(reports).toEqual([])
    expect(decider.stats).toEqual({ agreed: DECISIONS_PER_CASE, disagreed: 0, skipped: 0, failed: 0 })
  })

  it('nobody signed in has no access in the core either', () => {
    const reply = JSON.parse(core.runJson(JSON.stringify({ kind: 'listAccess', list: fixture.cases[0].list })))
    expect(reply.ok).toBe(true)
    expect(reply.value.role).toBeNull()
    expect(reply.value.canView).toBe(false)
  })
})
