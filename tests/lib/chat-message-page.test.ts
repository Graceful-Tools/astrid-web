/**
 * Task e0613ae5 — chat message paging, shared by /api/chat/channels/:id/messages
 * and its v1 twin.
 *
 * The cursor is the part worth pinning. Paging runs backwards through history,
 * so nextCursor must be the OLDEST message on the page. Taking the newest
 * instead would hand the client a cursor that returns the same page forever.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: { chatMessage: { findMany: vi.fn() } },
}))

import { fetchChatMessagePage } from '@/lib/chat-message-page'
import { prisma } from '@/lib/prisma'

const mockPrisma = vi.mocked(prisma)

function msg(n: number) {
  // n ascending = newer.
  const d = new Date(Date.UTC(2026, 0, n))
  return { id: `m${n}`, createdAt: d, updatedAt: d }
}

/** Prisma returns desc (newest first). */
function newestFirst(...ns: number[]) {
  return ns.map(msg).reverse()
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('fetchChatMessagePage (task e0613ae5)', () => {
  it('returns messages oldest-first for rendering', async () => {
    mockPrisma.chatMessage.findMany.mockResolvedValue(newestFirst(1, 2, 3) as never)

    const page = await fetchChatMessagePage({ channelId: 'c1' })

    expect(page.messages.map(m => m.id)).toEqual(['m1', 'm2', 'm3'])
  })

  it('serialises timestamps to ISO strings', async () => {
    mockPrisma.chatMessage.findMany.mockResolvedValue(newestFirst(1) as never)

    const page = await fetchChatMessagePage({ channelId: 'c1' })

    expect(page.messages[0].createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(page.messages[0].updatedAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('asks for one more than the limit to detect another page', async () => {
    mockPrisma.chatMessage.findMany.mockResolvedValue([] as never)

    await fetchChatMessagePage({ channelId: 'c1', limit: '10' })

    expect((mockPrisma.chatMessage.findMany.mock.calls[0][0] as never as { take: number }).take)
      .toBe(11)
  })

  it('drops the extra row and reports hasMore', async () => {
    // limit 2, three rows come back
    mockPrisma.chatMessage.findMany.mockResolvedValue(newestFirst(1, 2, 3) as never)

    const page = await fetchChatMessagePage({ channelId: 'c1', limit: 2 })

    expect(page.hasMore).toBe(true)
    expect(page.messages).toHaveLength(2)
  })

  it('points nextCursor at the OLDEST message on the page', async () => {
    // Paging walks backwards, so the next request wants everything before the
    // oldest thing we just returned. The newest would re-fetch this same page.
    mockPrisma.chatMessage.findMany.mockResolvedValue(newestFirst(1, 2, 3) as never)

    const page = await fetchChatMessagePage({ channelId: 'c1', limit: 2 })

    expect(page.messages.map(m => m.id)).toEqual(['m2', 'm3'])
    expect(page.nextCursor).toBe('2026-01-02T00:00:00.000Z')
  })

  it('has no cursor on the last page', async () => {
    mockPrisma.chatMessage.findMany.mockResolvedValue(newestFirst(1, 2) as never)

    const page = await fetchChatMessagePage({ channelId: 'c1', limit: 50 })

    expect(page.hasMore).toBe(false)
    expect(page.nextCursor).toBeNull()
  })

  it('has no cursor on an empty channel', async () => {
    mockPrisma.chatMessage.findMany.mockResolvedValue([] as never)

    const page = await fetchChatMessagePage({ channelId: 'c1' })

    expect(page).toMatchObject({ messages: [], hasMore: false, nextCursor: null })
  })

  it('narrows the query with `before` when given one', async () => {
    mockPrisma.chatMessage.findMany.mockResolvedValue([] as never)

    await fetchChatMessagePage({ channelId: 'c1', before: '2026-01-05T00:00:00.000Z' })

    const where = (mockPrisma.chatMessage.findMany.mock.calls[0][0] as never as {
      where: { channelId: string; createdAt?: { lt: Date } }
    }).where
    expect(where.channelId).toBe('c1')
    expect(where.createdAt?.lt).toEqual(new Date('2026-01-05T00:00:00.000Z'))
  })

  it('omits the timestamp filter entirely on the first page', async () => {
    mockPrisma.chatMessage.findMany.mockResolvedValue([] as never)

    await fetchChatMessagePage({ channelId: 'c1' })

    const where = (mockPrisma.chatMessage.findMany.mock.calls[0][0] as never as {
      where: Record<string, unknown>
    }).where
    expect(where).not.toHaveProperty('createdAt')
  })

  describe('limit clamping', () => {
    const takeOf = () =>
      (mockPrisma.chatMessage.findMany.mock.calls[0][0] as never as { take: number }).take

    beforeEach(() => {
      mockPrisma.chatMessage.findMany.mockResolvedValue([] as never)
    })

    it('caps a greedy request at 100', async () => {
      await fetchChatMessagePage({ channelId: 'c1', limit: '5000' })
      expect(takeOf()).toBe(101)
    })

    it('defaults to 50 when absent', async () => {
      await fetchChatMessagePage({ channelId: 'c1' })
      expect(takeOf()).toBe(51)
    })

    it('defaults to 50 rather than NaN on garbage', async () => {
      // parseInt('abc') is NaN; letting that reach `take` would break the query.
      await fetchChatMessagePage({ channelId: 'c1', limit: 'abc' })
      expect(takeOf()).toBe(51)
    })
  })
})
