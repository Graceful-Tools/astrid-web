/**
 * ADEV-304 ("[core-rules] Step B: list permissions"), server half: on the server astrid-core is
 * the only list-permission rule. A question it cannot answer is refused, never guessed by the
 * TypeScript. The browser is the same since ADEV-322.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  canUserDeleteList,
  canUserEditTasks,
  canUserManageList,
  getUserRoleInList,
  setListPermissionsCore,
} from '@/lib/list-permissions'
import { installTestListPermissionsCore } from '@/tests/helpers/list-permissions-core'

const owner = { id: 'owner-1' }
const list = { id: 'list-1', ownerId: 'owner-1', owner: { id: 'owner-1' }, listMembers: [], privacy: 'PRIVATE' }

function onServer() {
  vi.stubGlobal('window', undefined)
}
function inBrowser() {
  vi.stubGlobal('window', {})
}

afterEach(() => {
  vi.unstubAllGlobals()
  installTestListPermissionsCore()
})

describe('ADEV-304: the server refuses what astrid-core cannot answer', () => {
  it('refuses every check when no core is installed', () => {
    onServer()
    setListPermissionsCore(null)
    expect(getUserRoleInList(owner, list as never)).toBeNull()
    expect(canUserEditTasks(owner, list as never)).toBe(false)
    expect(canUserManageList(owner, list as never)).toBe(false)
    expect(canUserDeleteList(owner, list as never)).toBe(false)
  })

  it('refuses when the core throws', () => {
    onServer()
    setListPermissionsCore(() => {
      throw new Error('boom')
    })
    expect(getUserRoleInList(owner, list as never)).toBeNull()
    expect(canUserEditTasks(owner, list as never)).toBe(false)
  })

  it('refuses when the core declines or answers something that is not an answer', () => {
    onServer()
    setListPermissionsCore(() => undefined)
    expect(canUserManageList(owner, list as never)).toBe(false)
    setListPermissionsCore(() => 'not-a-role')
    expect(getUserRoleInList(owner, list as never)).toBeNull()
  })

  it('takes the core answer when it gives one', () => {
    onServer()
    installTestListPermissionsCore()
    expect(getUserRoleInList(owner, list as never)).toBe('owner')
    expect(canUserDeleteList(owner, list as never)).toBe(true)
  })
})

describe('ADEV-322: the browser has no TypeScript rule either', () => {
  it('refuses when no core is installed', () => {
    inBrowser()
    setListPermissionsCore(null)
    expect(getUserRoleInList(owner, list as never)).toBeNull()
    expect(canUserEditTasks(owner, list as never)).toBe(false)
  })

  it('refuses when the core throws', () => {
    inBrowser()
    setListPermissionsCore(() => {
      throw new Error('boom')
    })
    expect(canUserManageList(owner, list as never)).toBe(false)
  })
})
