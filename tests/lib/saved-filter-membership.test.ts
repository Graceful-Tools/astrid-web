/**
 * Task aa4e7eb0 — a saved filter accepts AI agents only.
 *
 * Jon, 2026-09-13: "disable adding non-AI members to saved filters."
 *
 * This is the other half of making filters per-user. Once a saved filter's
 * contents come from the VIEWER's own filters applied to the tasks the viewer
 * can see, adding a person to one promises something it cannot deliver: they
 * would not see the list you see, and nothing about their membership would
 * make them. So it is not a restriction to explain away — it is an operation
 * with no coherent result.
 *
 * AI agents stay eligible, because agent membership is not about sharing a
 * view: it is how an agent is granted access to act on a list at all.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  canUserBeAddedAsMember,
  isSavedFilterList,
  SAVED_FILTER_MEMBER_ERROR,
} from '@/lib/list-permissions'
import { BRAND } from '@/lib/brand/config'

describe('isSavedFilterList / canUserBeAddedAsMember (task aa4e7eb0)', () => {
  const HUMAN = { isAIAgent: false }
  const AGENT = { isAIAgent: true }
  const REAL_LIST = { isVirtual: false }
  const SAVED_FILTER = { isVirtual: true }

  it('recognises a saved filter', () => {
    expect(isSavedFilterList(SAVED_FILTER)).toBe(true)
    expect(isSavedFilterList(REAL_LIST)).toBe(false)
  })

  it('refuses a person on a saved filter', () => {
    expect(canUserBeAddedAsMember(HUMAN, SAVED_FILTER)).toBe(false)
  })

  it('allows an AI agent on a saved filter', () => {
    expect(canUserBeAddedAsMember(AGENT, SAVED_FILTER)).toBe(true)
  })

  it('allows anyone on a real list — this changes nothing there', () => {
    expect(canUserBeAddedAsMember(HUMAN, REAL_LIST)).toBe(true)
    expect(canUserBeAddedAsMember(AGENT, REAL_LIST)).toBe(true)
  })

  it('treats an unknown agent flag as a person, so a saved filter refuses', () => {
    // The safe direction: a caller that forgot to select `isAIAgent` gets a
    // refusal it will notice, not a silent bypass of the rule.
    expect(canUserBeAddedAsMember({}, SAVED_FILTER)).toBe(false)
    expect(canUserBeAddedAsMember(undefined, SAVED_FILTER)).toBe(false)
    expect(canUserBeAddedAsMember({ isAIAgent: null }, SAVED_FILTER)).toBe(false)
  })

  it('treats an unknown isVirtual as a real list', () => {
    // Permissive here on purpose: a read path that did not select the column
    // must not start refusing members on ordinary lists.
    expect(canUserBeAddedAsMember(HUMAN, {})).toBe(true)
    expect(canUserBeAddedAsMember(HUMAN, undefined)).toBe(true)
  })

  it('explains itself in one sentence a person can act on', () => {
    expect(SAVED_FILTER_MEMBER_ERROR).toMatch(/saved filter/i)
    expect(SAVED_FILTER_MEMBER_ERROR).toMatch(/AI agents/i)
  })
})

/**
 * The rule is enforced in the member service, which is the one place all three
 * surfaces (v1, legacy, MCP) funnel through — so a fourth caller inherits it
 * rather than having to remember it.
 */
describe('addListMember refuses people on a saved filter (task aa4e7eb0)', () => {
  beforeEach(() => vi.resetModules())

  async function load() {
    vi.doMock('@/lib/prisma', () => ({
      prisma: { listMember: { create: vi.fn() } },
    }))
    vi.doMock('@/lib/list-member-operations', () => ({
      invalidateMemberCache: vi.fn(),
      invalidateMemberCaches: vi.fn(),
    }))
    vi.doMock('@/lib/sse-utils', () => ({ broadcastToUsers: vi.fn() }))
    vi.doMock('@/lib/list-member-utils', () => ({ getListMemberIds: () => [] }))

    const service = await import('@/services/list-member.service')
    const { prisma } = await import('@/lib/prisma')
    return { service, prisma: vi.mocked(prisma, true) }
  }

  const savedFilter = { id: 'vl-1', name: 'Due soon', isVirtual: true }
  const realList = { id: 'l-1', name: 'Work', isVirtual: false }
  const actor = { id: 'owner-1', name: 'Jon' }

  it('throws SavedFilterMembershipError and writes nothing', async () => {
    const { service, prisma } = await load()

    await expect(
      service.addListMember({
        list: savedFilter,
        member: { id: 'person-1', email: 'p@example.com', isAIAgent: false },
        role: 'member',
        actor,
      })
    ).rejects.toBeInstanceOf(service.SavedFilterMembershipError)

    expect(prisma.listMember.create).not.toHaveBeenCalled()
  })

  it('lets an AI agent onto a saved filter', async () => {
    const { service, prisma } = await load()

    await service.addListMember({
      list: savedFilter,
      member: { id: 'ai-agent-claude', email: `claude@${BRAND.agentEmailDomain}`, isAIAgent: true },
      role: 'member',
      actor,
    })

    expect(prisma.listMember.create).toHaveBeenCalledWith({
      data: { listId: 'vl-1', userId: 'ai-agent-claude', role: 'member' },
    })
  })

  it('still adds a person to an ordinary list', async () => {
    const { service, prisma } = await load()

    await service.addListMember({
      list: realList,
      member: { id: 'person-1', email: 'p@example.com', isAIAgent: false },
      role: 'member',
      actor,
    })

    expect(prisma.listMember.create).toHaveBeenCalledWith({
      data: { listId: 'l-1', userId: 'person-1', role: 'member' },
    })
  })

  it('refuses when the caller did not say whether the member is an agent', async () => {
    // `isAIAgent` is optional on the type, so this is the case a future caller
    // gets wrong. It must fail loudly rather than admit a person quietly.
    const { service, prisma } = await load()

    await expect(
      service.addListMember({
        list: savedFilter,
        member: { id: 'person-1', email: 'p@example.com' },
        role: 'member',
        actor,
      })
    ).rejects.toBeInstanceOf(service.SavedFilterMembershipError)

    expect(prisma.listMember.create).not.toHaveBeenCalled()
  })
})
