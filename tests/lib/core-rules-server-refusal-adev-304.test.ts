/**
 * ADEV-304 ("[core-rules] Step B: list permissions"), server half: on the server astrid-core is
 * the only list-permission rule. A question it cannot answer is refused, never guessed by the
 * TypeScript. The browser keeps the TypeScript until its door loads (deleting that is not yet safe:
 * the e2e journeys break when the app shell waits for the door).
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

describe('ADEV-304: the browser keeps the TypeScript until its door can answer', () => {
  it('answers with the TypeScript when no core is installed', () => {
    inBrowser()
    setListPermissionsCore(null)
    expect(getUserRoleInList(owner, list as never)).toBe('owner')
    expect(canUserEditTasks(owner, list as never)).toBe(true)
  })

  it('answers with the TypeScript when the core throws', () => {
    inBrowser()
    setListPermissionsCore(() => {
      throw new Error('boom')
    })
    expect(canUserManageList(owner, list as never)).toBe(true)
  })
})
