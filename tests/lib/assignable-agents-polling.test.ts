/**
 * Who the assignee picker may offer, now that a key is not the only runtime.
 *
 * The fallback used to be `getKeyedAgentEmails` alone, which was correct when
 * the server ran every agent: no key, nothing could execute, nothing to offer.
 * Polling mode broke that equivalence — a keyless claude@ is a working agent
 * whose runtime is the user's own harness — and the picker hiding it made the
 * polling workflow's step two ("assign it a task") impossible.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockPrisma } from '@/tests/setup'
import { getOfferableAgentEmails } from '@/lib/ai/assignable-agents'

vi.mock('@/lib/api-key-cache', () => ({
  hasValidApiKey: vi.fn(async () => false),
}))

import { hasValidApiKey } from '@/lib/api-key-cache'
const mockHasKey = vi.mocked(hasValidApiKey)

describe('getOfferableAgentEmails', () => {
  beforeEach(() => {
    mockHasKey.mockReset()
    mockHasKey.mockResolvedValue(false)
    mockPrisma.user.findUnique.mockReset()
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', mcpSettings: null })
  })

  it('offers every coding agent to a keyless user, because polling needs no key', async () => {
    const offered = await getOfferableAgentEmails('u1')

    // Keyless coding agents resolve to polling mode, so all of them are workable.
    expect(offered).toContain('claude@astrid.cc')
    expect(offered).toContain('copilot@astrid.cc')
    expect(offered).toContain('codex@astrid.cc')
    // Codex and OpenAI are one option; in polling mode the identity is codex@.
    expect(offered).not.toContain('openai@astrid.cc')
  })

  it('offers openai@ and hides codex@ once the merged option runs server-side', async () => {
    mockHasKey.mockImplementation(async (_u: string, service: string) => service === 'openai')
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      mcpSettings: JSON.stringify({ apiKeys: { openai: { encrypted: 'x', iv: 'y' } } }),
    })

    const offered = await getOfferableAgentEmails('u1')

    expect(offered).toContain('openai@astrid.cc')
    // Two names for the same agent would appear in every picker otherwise.
    expect(offered).not.toContain('codex@astrid.cc')
  })

  it('does not duplicate an agent that is both keyed and offered', async () => {
    mockHasKey.mockImplementation(async (_userId: string, service: string) => service === 'claude')
    // A saved key resolves claude to api mode — it must appear exactly once,
    // via the keyed path.
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      mcpSettings: JSON.stringify({ apiKeys: { claude: { encrypted: 'x', iv: 'y' } } }),
    })

    const offered = await getOfferableAgentEmails('u1')

    expect(offered.filter(e => e === 'claude@astrid.cc')).toHaveLength(1)
  })

  it('withholds an agent explicitly set to api mode with no key to run on', async () => {
    // The user said "Astrid runs it" and gave Astrid nothing to run it with.
    // Offering that agent would recreate the assign-then-400 dead end, which
    // is the exact failure polling mode exists to remove.
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      mcpSettings: JSON.stringify({ agentModes: { claude: 'api' } }),
    })

    const offered = await getOfferableAgentEmails('u1')

    expect(offered).not.toContain('claude@astrid.cc')
    // The others keep their polling default and stay offered.
    expect(offered).toContain('copilot@astrid.cc')
  })
})
