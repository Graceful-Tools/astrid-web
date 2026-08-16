import { describe, expect, it } from 'vitest'
import { getAgentType } from '@/lib/webhooks/agent-type'
import { isLocalHarnessAgentEmail } from '@/lib/brand/agent-emails'
import { isCodingAgent } from '@/lib/ai-agent-utils'

describe('getAgentType', () => {
  it('recognizes the distinct local Codex identity without treating OpenAI as Codex', () => {
    expect(getAgentType('codex@astrid.cc')).toBe('codex')
    expect(getAgentType('openai@astrid.cc')).toBe('openai')
  })

  it('does not recognize a Codex mailbox outside the configured agent domain', () => {
    expect(getAgentType('codex@example.com')).toBeNull()
    expect(isLocalHarnessAgentEmail('codex@example.com')).toBe(false)
  })

  it('keeps local Codex polling-only rather than treating it as a server coding workflow', () => {
    expect(isLocalHarnessAgentEmail('codex@astrid.cc')).toBe(true)
    expect(isCodingAgent({
      isAIAgent: true,
      aiAgentType: 'local_harness_agent',
    })).toBe(false)
  })
})
