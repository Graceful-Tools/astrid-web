/**
 * A message written by the coding agent must be signed by the coding agent.
 *
 * AWTD-878 fixed this for task comments. The same bug was waiting in list
 * chat: client-credentials auth resolves to the OAuth client's OWNER, so the
 * scheduled /fixall run summary would have arrived in the iOS list chat under
 * Jon's own name — him talking to himself every half hour. The rule now lives
 * in one place and both routes call it.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { resolveAgentAuthor } from '@/lib/ai-agent-author'
import { prisma } from '@/lib/prisma'

vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: vi.fn() } },
}))

const mockUserFindUnique = prisma.user.findUnique as Mock

const HUMAN = { userId: 'user-jon' }

describe('resolveAgentAuthor', () => {
  beforeEach(() => vi.clearAllMocks())

  it('signs as the caller when no agent is named', async () => {
    const result = await resolveAgentAuthor(HUMAN)
    expect(result).toEqual({ ok: true, authorId: 'user-jon' })
    expect(mockUserFindUnique).not.toHaveBeenCalled()
  })

  it('prefers the token-bound agent over anything in the body', async () => {
    const result = await resolveAgentAuthor(
      { userId: 'user-jon', agentUser: { id: 'ai-claude', email: 'claude@astrid.cc' } },
      'ai-someone-else'
    )
    expect(result).toEqual({ ok: true, authorId: 'ai-claude', agentEmail: 'claude@astrid.cc' })
    // A token bound to a mailbox is a stronger claim than a request body, so
    // the body is not even looked up.
    expect(mockUserFindUnique).not.toHaveBeenCalled()
  })

  it('signs as the AI agent named by aiAgentId', async () => {
    mockUserFindUnique.mockResolvedValue({ id: 'ai-claude', isAIAgent: true, email: 'claude@astrid.cc' })
    const result = await resolveAgentAuthor(HUMAN, 'ai-claude')
    expect(result).toEqual({ ok: true, authorId: 'ai-claude', agentEmail: 'claude@astrid.cc' })
  })

  it('accepts a brand agent mailbox whose isAIAgent flag was never set', async () => {
    mockUserFindUnique.mockResolvedValue({ id: 'ai-claude', isAIAgent: false, email: 'claude@astrid.cc' })
    const result = await resolveAgentAuthor(HUMAN, 'ai-claude')
    expect(result).toMatchObject({ ok: true, authorId: 'ai-claude' })
  })

  it('rejects an unknown aiAgentId rather than silently signing as the human', async () => {
    mockUserFindUnique.mockResolvedValue(null)
    const result = await resolveAgentAuthor(HUMAN, 'nope')
    expect(result).toEqual({ ok: false, error: 'Invalid aiAgentId - user not found' })
  })

  it('rejects an aiAgentId that names a real person', async () => {
    mockUserFindUnique.mockResolvedValue({ id: 'user-someone', isAIAgent: false, email: 'someone@example.com' })
    const result = await resolveAgentAuthor(HUMAN, 'user-someone')
    expect(result).toEqual({
      ok: false,
      error: 'Invalid aiAgentId - specified user is not an AI agent',
    })
  })
})
