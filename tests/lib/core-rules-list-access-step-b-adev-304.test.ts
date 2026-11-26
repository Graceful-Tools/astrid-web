// @vitest-environment node
/**
 * ADEV-304, step B for list permissions (docs/architecture/CORE_RULES_FALLBACK_RETIREMENT.md):
 * astrid-core's `listAccess` is the only rule. The TypeScript copy in lib/list-permissions.ts is
 * deleted, so a permission check the core cannot answer is a REFUSAL (no role, every predicate
 * false), never a guess, even for the list's own owner.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  canEditListSettings,
  canUserDeleteList,
  canUserEditTask,
  canUserEditTasks,
  canUserManageList,
  canUserManageMembers,
  getUserRoleInList,
  hasExplicitListRole,
  setListPermissionsCore,
  type ListPermissionsCore,
} from '@/lib/list-permissions'
import {
  assertListPermissionsCoreInstalled,
  installListPermissionsCore,
  listPermissionsCoreStatus,
} from '@/lib/core-rules/list-permissions-core'
import { installTestListPermissionsCore } from '@/tests/helpers/list-permissions-core'

const ME = { id: 'me' }
/** A list the user OWNS: the most-granted case, so a refusal here cannot be the rule's answer. */
const OWNED = { id: 'l', ownerId: 'me', privacy: 'PRIVATE', listMembers: [] }

function everyAnswer() {
  return {
    role: getUserRoleInList(ME, OWNED),
    canEditTasks: canUserEditTasks(ME, OWNED),
    canEditTask: canUserEditTask(ME, { creatorId: 'me' }, OWNED),
    hasExplicitRole: hasExplicitListRole(ME, OWNED),
    canManage: canUserManageList(ME, OWNED),
    canManageMembers: canUserManageMembers(ME, OWNED),
    canDelete: canUserDeleteList(ME, OWNED),
    settings: canEditListSettings(OWNED, 'me'),
  }
}

const REFUSED = {
  role: null,
  canEditTasks: false,
  canEditTask: false,
  hasExplicitRole: false,
  canManage: false,
  canManageMembers: false,
  canDelete: false,
  settings: false,
}

const GRANTED = {
  role: 'owner',
  canEditTasks: true,
  canEditTask: true,
  hasExplicitRole: true,
  canManage: true,
  canManageMembers: true,
  canDelete: true,
  settings: true,
}

afterEach(() => {
  // Leave the file the way tests/setup.ts left it: the vendored core installed.
  installTestListPermissionsCore()
})

describe('ADEV-304: a permission check the core cannot answer is a refusal', () => {
  it('with the core installed, the owner is granted everything', () => {
    expect(everyAnswer()).toEqual(GRANTED)
  })

  it('with no core installed, the owner is refused everything', () => {
    setListPermissionsCore(null)
    expect(everyAnswer()).toEqual(REFUSED)
  })

  it.each<[string, ListPermissionsCore]>([
    ['declines (undefined)', () => undefined],
    ['throws', () => {
      throw new Error('trap')
    }],
    ['answers something that is not an answer', (q) => (q.decision === 'role' ? 'superuser' : 'yes')],
  ])('a core that %s is refused, not guessed', (_label, core) => {
    setListPermissionsCore(core)
    expect(everyAnswer()).toEqual(REFUSED)
  })
})

describe('ADEV-304: the TypeScript rule is gone', () => {
  const source = readFileSync(path.join(process.cwd(), 'lib/list-permissions.ts'), 'utf8')

  it.each(['roleInList', 'getProjectRole', 'editTasks', 'editTask'])('lib/list-permissions.ts declares no %s', (name) => {
    expect(source).not.toMatch(new RegExp(`function ${name}\\b`))
  })
})

describe('ADEV-304: the server install is loud, and has no rollback that silently denies', () => {
  it('a core that does not load is reported, and the boot check throws', () => {
    expect(installListPermissionsCore('', () => null)).toBe(false)
    expect(listPermissionsCoreStatus()).toMatchObject({ mode: 'decide', loaded: false })
    expect(() => assertListPermissionsCoreInstalled()).toThrow(/astrid-core/)
  })

  it('a loaded core passes the boot check', () => {
    expect(installListPermissionsCore('')).toBe(true)
    expect(() => assertListPermissionsCoreInstalled()).not.toThrow()
  })

  it.each(['shadow', 'off'])('ASTRID_CORE_RULES=%s no longer switches list permissions away from the core', (setting) => {
    expect(installListPermissionsCore(setting)).toBe(true)
    expect(listPermissionsCoreStatus()).toMatchObject({ mode: 'decide', loaded: true })
    expect(everyAnswer()).toEqual(GRANTED)
  })
})
