// @vitest-environment node
/**
 * ADEV-90: the client's permission affordances ask core `listAccess` through the browser build.
 *
 * Every case of the permissions fixture goes through the web's PUBLIC functions with the BROWSER
 * package (packages/astrid-rules/web, instantiated from its own .wasm) installed by the door's
 * own installer, and must give the fixture's answers, every one asked of the core. Since ADEV-304
 * there is no TypeScript rule: flag off (no door), or a core that cannot answer, is a refusal, and
 * the door publishes whether permissions are pending, ready or unavailable.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as glue from '@/packages/astrid-rules/web/astrid_rules_wasm.js'
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
import {
  browserListPermissionsState,
  loadBrowserCoreRules,
  resetBrowserCoreRulesForTests,
  subscribeBrowserListPermissions,
} from '@/lib/core-rules/browser'
import { installBrowserListPermissions } from '@/lib/core-rules/browser-list-permissions'

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

const fixture = JSON.parse(readFileSync(path.join(PACKAGE_DIR, 'fixtures', 'permissions.json'), 'utf8')) as Fixture
glue.initSync({ module: readFileSync(path.join(PACKAGE_DIR, 'web', 'astrid_rules_wasm_bg.wasm')) })

function answersFor(list: FixtureList) {
  const user = { id: fixture.userId }
  return {
    role: getUserRoleInList(user, list),
    canEditTasks: canUserEditTasks(user, list),
    canEditOwnTask: canUserEditTask(user, { creatorId: fixture.ownTaskCreatorId }, list),
    canEditOthersTask: canUserEditTask(user, { creatorId: fixture.othersTaskCreatorId }, list),
    hasExplicitListRole: hasExplicitListRole(user, list),
    canManageList: canUserManageList(user, list),
    canManageMembers: canUserManageMembers(user, list),
    canDeleteList: canUserDeleteList(user, list),
  }
}

const cases = fixture.cases.map((c) => [c.name, c] as const)

describe('ADEV-90: permission affordances through the browser build', () => {
  afterEach(() => {
    resetBrowserCoreRulesForTests()
  })

  it('the browser build answers listAccess', () => {
    expect(glue.kinds()).toContain('listAccess')
  })

  it.each(cases)('%s', (_name, c) => {
    const runJson = vi.fn(glue.runJson)
    expect(installBrowserListPermissions({ runJson, answers: (k) => glue.kinds().includes(k) })).toBe(true)
    expect(answersFor(c.list)).toEqual({
      role: c.expected.role,
      canEditTasks: c.expected.canEditTasks,
      canEditOwnTask: c.expected.canEditOwnTask,
      canEditOthersTask: c.expected.canEditOthersTask,
      hasExplicitListRole: c.expected.hasExplicitListRole,
      canManageList: c.expected.canManageList,
      canManageMembers: c.expected.canManageMembers,
      canDeleteList: c.expected.canDeleteList,
    })
    expect(runJson).toHaveBeenCalled()
    expect(JSON.parse(runJson.mock.calls[0][0]).kind).toBe('listAccess')
  })

  it('installs nothing when the build does not answer listAccess', () => {
    const runJson = vi.fn(glue.runJson)
    expect(installBrowserListPermissions({ runJson, answers: () => false })).toBe(false)
    answersFor(fixture.cases[0].list)
    expect(runJson).not.toHaveBeenCalled()
  })

  it('ADEV-304: flag off: the loader installs nothing, permissions are unavailable, and every check is refused', async () => {
    setListPermissionsCore(null)
    const runJson = vi.fn(glue.runJson)
    expect(await loadBrowserCoreRules({ enabled: false })).toBeNull()
    expect(browserListPermissionsState()).toBe('unavailable')
    const owned = fixture.cases.find((c) => c.expected.role === 'owner')!
    expect(answersFor(owned.list)).toEqual({
      role: null,
      canEditTasks: false,
      canEditOwnTask: false,
      canEditOthersTask: false,
      hasExplicitListRole: false,
      canManageList: false,
      canManageMembers: false,
      canDeleteList: false,
    })
    expect(runJson).not.toHaveBeenCalled()
  })

  it('ADEV-304: permissions are pending until the door loads, then ready, and subscribers hear it', async () => {
    const init = vi.fn(() => Promise.resolve())
    const heard = vi.fn()
    const unsubscribe = subscribeBrowserListPermissions(heard)
    expect(browserListPermissionsState()).toBe('pending')
    const load = loadBrowserCoreRules({
      enabled: true,
      load: () => Promise.resolve({ default: init, runJson: glue.runJson, kinds: glue.kinds }),
    })
    expect(browserListPermissionsState()).toBe('pending')
    await load
    expect(browserListPermissionsState()).toBe('ready')
    expect(heard).toHaveBeenCalled()
    unsubscribe()
    const c = fixture.cases[0]
    expect(canUserManageList({ id: fixture.userId }, c.list)).toBe(c.expected.canManageList)
  })

  it('ADEV-304: a door that fails to load leaves permissions unavailable', async () => {
    await loadBrowserCoreRules({ enabled: true, load: () => Promise.reject(new Error('chunk failed')) })
    expect(browserListPermissionsState()).toBe('unavailable')
  })

  it('ADEV-304: a build without listAccess leaves permissions unavailable', async () => {
    const init = vi.fn(() => Promise.resolve())
    await loadBrowserCoreRules({
      enabled: true,
      load: () => Promise.resolve({ default: init, runJson: glue.runJson, kinds: () => ['smartParse'] }),
    })
    expect(browserListPermissionsState()).toBe('unavailable')
  })

  it('ADEV-304: loading the door installs the decider; a core that errors is refused, not guessed', async () => {
    const init = vi.fn(() => Promise.resolve())
    const bad = vi.fn(() => JSON.stringify({ ok: false, error: { kind: 'badRequest' } }))
    await loadBrowserCoreRules({
      enabled: true,
      load: () => Promise.resolve({ default: init, runJson: bad, kinds: () => ['listAccess'] }),
    })
    const owned = fixture.cases.find((c) => c.expected.canManageList)!
    expect(canUserManageList({ id: fixture.userId }, owned.list)).toBe(false)
    expect(bad).toHaveBeenCalled()
  })
})
