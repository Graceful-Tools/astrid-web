import { describe, it, expect } from 'vitest'
import { SCOPE_GROUPS } from '@/lib/oauth/oauth-scopes'

describe('ADEV-356: an agent the user connected can read the task screenshots', () => {
  it('ai_agent carries attachments:read, and nothing that writes or deletes files', () => {
    expect(SCOPE_GROUPS.ai_agent).toContain('attachments:read')
    expect(SCOPE_GROUPS.ai_agent).not.toContain('attachments:write')
    expect(SCOPE_GROUPS.ai_agent).not.toContain('attachments:delete')
  })
})
