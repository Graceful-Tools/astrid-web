/**
 * AWTD-1504: agents get `lists:configure`, not `lists:write`.
 */

import { describe, it, expect } from 'vitest'
import { listConfigureViolation, LIST_CONFIGURE_ROUTE_SCOPES } from '@/lib/list-configure-scope'
import { SCOPE_GROUPS, isValidScope } from '@/lib/oauth/oauth-scopes'

describe('lists:configure (AWTD-1504)', () => {
  it('is a real scope carried by the ai_agent group, without lists:write', () => {
    expect(isValidScope('lists:configure')).toBe(true)
    expect(SCOPE_GROUPS.ai_agent).toContain('lists:configure')
    expect(SCOPE_GROUPS.ai_agent).not.toContain('lists:write')
    expect(SCOPE_GROUPS.ai_agent).not.toContain('lists:delete')
  })

  it('lets the list routes accept either scope', () => {
    expect(LIST_CONFIGURE_ROUTE_SCOPES).toEqual(['lists:write', 'lists:configure'])
  })

  it('allows name, description, default assignee and colour', () => {
    expect(
      listConfigureViolation(['lists:configure'], {
        name: 'Build', description: '# Do', defaultAssigneeId: 'u', color: '#10b981', privacy: 'PRIVATE',
      }),
    ).toBeNull()
  })

  it('refuses membership, visibility and other fields instead of dropping them', () => {
    const message = listConfigureViolation(['lists:configure'], {
      name: 'Build', privacy: 'PUBLIC', memberIds: ['x'], imageUrl: 'y',
    })
    expect(message).toMatch(/privacy/)
    expect(message).toMatch(/memberIds/)
    expect(message).toMatch(/imageUrl/)
    expect(message).not.toMatch(/not allowed: .*name/)
  })

  it('leaves lists:write and the wildcard unrestricted', () => {
    expect(listConfigureViolation(['lists:write'], { privacy: 'PUBLIC' })).toBeNull()
    expect(listConfigureViolation(['*'], { memberIds: ['x'] })).toBeNull()
  })
})
