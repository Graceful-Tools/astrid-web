// @vitest-environment node
/**
 * Parity proof for cutting lib/list-permissions.ts over to astrid-core.
 *
 * Every case in the permissions contract fixture (generated from this repo's own
 * list-permissions.ts, vendored at the pinned core revision) goes through BOTH the TypeScript
 * rules and the vendored WebAssembly core, and every decision must agree — with each other and
 * with the fixture. A disagreement here is one the shadow log would report in production.
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
  setListPermissionsShadow,
  type ShadowedAnswer,
} from '@/lib/list-permissions'
import { coreRequestFor, createListPermissionsShadow } from '@/lib/core-rules/list-permissions-shadow'
import { loadCoreRulesFrom } from '@/lib/core-rules/wasm'

const PACKAGE_DIR = path.join(process.cwd(), 'packages', 'astrid-rules')

interface Fixture {
  userId: string
  ownTaskCreatorId: string
  othersTaskCreatorId: string
  cases: Array<{
    name: string
    list: Parameters<typeof getUserRoleInList>[1]
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

function askCore(request: object): Record<string, unknown> {
  const reply = JSON.parse(core.runJson(JSON.stringify(request)))
  expect(reply.ok).toBe(true)
  return reply.value
}

/** The core's answer through the same request builder the production shadow uses. */
function coreAnswer(list: Fixture['cases'][number]['list'], taskCreatorId?: string) {
  const built = coreRequestFor({
    decision: 'role',
    user: { id: fixture.userId },
    list,
    taskCreatorId,
    answer: null,
  })
  if ('skip' in built) throw new Error(`fixture case is outside the core's domain: ${built.skip}`)
  return askCore(built.request)
}

describe('astrid-core (wasm) agrees with lib/list-permissions.ts on the permissions fixture', () => {
  it('loads the vendored build at a pinned revision', () => {
    expect(core.revision).toMatch(/^[0-9a-f]{40}$/)
    expect(fixture.cases.length).toBeGreaterThan(0)
  })

  it.each(fixture.cases.map((c) => [c.name, c] as const))('%s', (_name, testCase) => {
    const user = { id: fixture.userId }
    const { list, expected } = testCase
    const own = coreAnswer(list, fixture.ownTaskCreatorId)
    const others = coreAnswer(list, fixture.othersTaskCreatorId)

    const ts = {
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
    const wasm = {
      role: own.role ?? null,
      canViewList: own.canView,
      canEditTasks: own.canEditTasks,
      canEditOwnTask: own.canEditTask,
      canEditOthersTask: others.canEditTask,
      hasExplicitListRole: own.hasExplicitRole,
      canManageList: own.canManage,
      canManageMembers: own.canManageMembers,
      canDeleteList: own.canDelete,
    }

    expect(ts).toEqual(expected)
    expect(wasm).toEqual(expected)
  })

  it('nobody signed in has no access in the core either', () => {
    const value = askCore({ kind: 'listAccess', list: fixture.cases[0].list })
    expect(value.role).toBeNull()
    expect(value.canView).toBe(false)
  })
})

describe('the shadow, wired to the real core, stays silent over the fixture', () => {
  afterEach(() => setListPermissionsShadow(null))

  it('compares every decision and finds no disagreement', () => {
    const reports: unknown[] = []
    const shadow = createListPermissionsShadow(core.runJson, {
      disagreement: (d) => reports.push(d),
      failure: (d) => reports.push(d),
    })
    setListPermissionsShadow(shadow.observe)

    const user = { id: fixture.userId }
    for (const { list } of fixture.cases) {
      getUserRoleInList(user, list)
      canUserEditTasks(user, list)
      canUserEditTask(user, { creatorId: fixture.ownTaskCreatorId }, list)
      canUserEditTask(user, { creatorId: fixture.othersTaskCreatorId }, list)
      hasExplicitListRole(user, list)
      canUserManageList(user, list)
      canUserManageMembers(user, list)
      canUserDeleteList(user, list)
    }

    expect(reports).toEqual([])
    expect(shadow.stats).toMatchObject({ disagreed: 0, failed: 0, skipped: 0 })
    expect(shadow.stats.compared).toBe(fixture.cases.length * 8)
  })

  it('skips lists that carry web-only inputs instead of reporting a known divergence', () => {
    const answered: ShadowedAnswer = {
      decision: 'role',
      user: { id: 'u' },
      list: { ownerId: 'x', project: { ownerId: 'u' } },
      answer: 'admin',
    }
    expect(coreRequestFor(answered)).toEqual({ skip: 'project' })
    expect(coreRequestFor({ ...answered, list: { ownerId: 'x', admins: [{ id: 'u' }] } })).toEqual({
      skip: 'legacy-arrays',
    })
  })
})
