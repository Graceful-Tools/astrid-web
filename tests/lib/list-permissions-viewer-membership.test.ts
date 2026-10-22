/**
 * RED for AWTD-1318.
 *
 * GitHub Projects materialises roles from GitHub (spec §8.6): project admin →
 * admin, write → member, read → **viewer**, and "PRODUCT_CONTRACT's matrix
 * still applies over the derived roles". lib/github/projects/roles.ts returns
 * 'viewer' and the board sync stores it on a ListMember row — but roleInList
 * recognised only "admin", and any other membership read as member, so a
 * read-only GitHub collaborator could edit the mirrored list's Astrid-local
 * state (manual order, list-local fields).
 *
 * A viewer membership is read-only; a project role still raises it, as the
 * higher of the list and project role wins (2026-10-04).
 */
import { describe, it, expect } from 'vitest'
import {
  getUserRoleInList,
  canUserEditTasks,
  hasExplicitListRole,
  canUserManageList,
} from '@/lib/list-permissions'

const me = { id: 'me' }
const list = (role: string, extra: Record<string, unknown> = {}) => ({
  id: 'l1',
  ownerId: 'owner',
  privacy: 'PRIVATE',
  listMembers: [{ userId: 'me', role }],
  ...extra,
})
const project = (members: Array<{ userId: string; role: string }>, ownerId = 'project-owner') => ({
  project: { id: 'p1', ownerId, members, lists: [] },
})

describe('a viewer membership is read-only (AWTD-1318)', () => {
  it.each(['viewer', 'VIEWER', 'Viewer'])('role %s', role => {
    const l = list(role) as never
    expect(getUserRoleInList(me, l)).toBe('viewer')
    expect(canUserEditTasks(me, l)).toBe(false)
    expect(hasExplicitListRole(me, l)).toBe(false)
    expect(canUserManageList(me, l)).toBe(false)
  })

  it('a project member role raises it to member', () => {
    const l = list('viewer', project([{ userId: 'me', role: 'member' }])) as never
    expect(getUserRoleInList(me, l)).toBe('member')
    expect(canUserEditTasks(me, l)).toBe(true)
  })

  it('owning the project raises it to admin', () => {
    expect(getUserRoleInList(me, list('viewer', project([], 'me')) as never)).toBe('admin')
  })

  it('on a public collaborative list a viewer may still add tasks, as any viewer may', () => {
    const l = list('viewer', { privacy: 'PUBLIC', publicListType: 'collaborative' }) as never
    expect(getUserRoleInList(me, l)).toBe('viewer')
    expect(canUserEditTasks(me, l)).toBe(true)
  })

  it('an unrecognised role still means member (presence is membership)', () => {
    expect(getUserRoleInList(me, list('collaborator') as never)).toBe('member')
  })
})
