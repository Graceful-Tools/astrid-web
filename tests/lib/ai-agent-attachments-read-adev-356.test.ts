/**
 * ADEV-356: an agent that a user has given access to a task must be able to open
 * that task's attachments (a screenshot) from a cloud runner. The secure-files
 * route requires `attachments:read` on a token, and the ai_agent group lacked it,
 * so every runner got 403 on the screenshot and handed the task back.
 */

import { describe, it, expect } from 'vitest'
import { SCOPE_GROUPS } from '@/lib/oauth/oauth-scopes'

describe('ai_agent scope group (ADEV-356)', () => {
  it('carries attachments:read so a runner can open task screenshots', () => {
    expect(SCOPE_GROUPS.ai_agent).toContain('attachments:read')
  })

  it('stays read-only for attachments', () => {
    expect(SCOPE_GROUPS.ai_agent).not.toContain('attachments:write')
    expect(SCOPE_GROUPS.ai_agent).not.toContain('attachments:delete')
  })
})
