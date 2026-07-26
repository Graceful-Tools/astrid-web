/**
 * @vitest-environment node
 *
 * Regression: available-agents returned `id: agentUser?.id || agent.email` for
 * built-in agents. Agent User rows are created by scripts/create-specific-ai-agents.ts,
 * which had never been run against production for copilot@astrid.cc — so the
 * picker listed GitHub Copilot with the string "copilot@astrid.cc" as its id.
 *
 * Task.assigneeId is FK-constrained to User.id, so assigning that agent blew up
 * on a foreign-key violation: the agent looked selectable and failed on use.
 *
 * ensureAgentUser() creates the row on demand from the AI_AGENT_CONFIG registry,
 * the same way ensureAstridAgent() already does for astrid@astrid.cc, so a real
 * id is always returned and no manual production seed step is required.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const findFirst = vi.fn()
const create = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findFirst: (...a: unknown[]) => findFirst(...a), create: (...a: unknown[]) => create(...a) } },
}))

import { ensureAgentUser } from '@/lib/ai/ensure-agent-user'

beforeEach(() => {
  findFirst.mockReset()
  create.mockReset()
})

describe('ensureAgentUser', () => {
  it('returns the existing agent row without creating a duplicate', async () => {
    findFirst.mockResolvedValue({ id: 'ai-agent-claude', email: 'claude@astrid.cc' })

    const agent = await ensureAgentUser('claude@astrid.cc')

    expect(agent?.id).toBe('ai-agent-claude')
    expect(create).not.toHaveBeenCalled()
  })

  it('creates the copilot agent row from the registry when it is missing', async () => {
    findFirst.mockResolvedValue(null)
    create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: 'new-id', ...data }))

    const agent = await ensureAgentUser('copilot@astrid.cc')

    expect(create).toHaveBeenCalledTimes(1)
    const { data } = create.mock.calls[0][0]
    expect(data.email).toBe('copilot@astrid.cc')
    expect(data.isAIAgent).toBe(true)
    // agentType comes from AI_AGENT_CONFIG, not a second hardcoded copy.
    expect(data.aiAgentType).toBe('copilot_agent')
    expect(agent?.id).toBe('new-id')
  })

  it('never returns an email as the id — that breaks the assigneeId foreign key', async () => {
    findFirst.mockResolvedValue(null)
    create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: 'generated-cuid', ...data }))

    const agent = await ensureAgentUser('copilot@astrid.cc')

    expect(agent?.id).not.toContain('@')
  })

  it('returns null for an email that is not a registered agent', async () => {
    findFirst.mockResolvedValue(null)

    const agent = await ensureAgentUser('someone@example.com')

    expect(agent).toBeNull()
    expect(create).not.toHaveBeenCalled()
  })
})
