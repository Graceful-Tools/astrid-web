// @vitest-environment node
/**
 * ADEV-90: the client's permission affordances ask core `listAccess` through the browser build.
 *
 * Every case of the permissions fixture goes through the web's PUBLIC functions with the BROWSER
 * package (packages/astrid-rules/web, instantiated from its own .wasm) installed by the door's
 * own installer, and must give the fixture's answers, every one asked of the core. Flag off (no
 * door) leaves the TypeScript deciding, as before.
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
import { loadBrowserCoreRules, resetBrowserCoreRulesForTests } from '@/lib/core-rules/browser'
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
    setListPermissionsCore(null)
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

  it('flag off: the loader installs nothing and the TypeScript decides', async () => {
    const runJson = vi.fn(glue.runJson)
    expect(await loadBrowserCoreRules({ enabled: false })).toBeNull()
    for (const c of fixture.cases) answersFor(c.list)
    expect(runJson).not.toHaveBeenCalled()
  })

  it('loading the door installs the decider; a core that errors falls back to the TypeScript', async () => {
    const init = vi.fn(() => Promise.resolve())
    const bad = vi.fn(() => JSON.stringify({ ok: false, error: { kind: 'badRequest' } }))
    await loadBrowserCoreRules({
      enabled: true,
      load: () => Promise.resolve({ default: init, runJson: bad, kinds: () => ['listAccess'] }),
    })
    const c = fixture.cases[0]
    // The fallback is the browser's (ADEV-304: the server refuses instead), so ask as a browser.
    vi.stubGlobal('window', {})
    try {
      expect(canUserManageList({ id: fixture.userId }, c.list)).toBe(c.expected.canManageList)
    } finally {
      vi.unstubAllGlobals()
    }
    expect(bad).toHaveBeenCalled()
  })
})
