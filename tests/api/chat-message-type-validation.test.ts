/**
 * RED for task 87e19910 — the same unvalidated-enum bug, two more routes.
 *
 * `ChatMessage.type` is the SAME `CommentType` enum as `Comment.type`
 * (TEXT | MARKDOWN | ATTACHMENT). Four routes write it straight from an
 * untyped request body:
 *
 *   app/api/v1/tasks/[id]/comments        type: body.type || 'TEXT'   ← fixed earlier
 *   app/api/v1/chat/.../messages          type: type || 'TEXT'
 *   app/api/v1/agent/chat/.../messages    type: type || 'MARKDOWN'
 *   app/api/chat/.../messages  (legacy)   type: type || 'TEXT'
 *
 * None of the three chat routes validates it. The only mention of the allowed
 * values anywhere in them is a DOC COMMENT — `type?: 'TEXT' | 'MARKDOWN' |
 * 'ATTACHMENT'` — which documents a contract nothing enforces.
 *
 * So `{ type: 'BANANA' }` reaches the Prisma driver and surfaces as a 500 where
 * the caller deserved a 400, exactly as it did for comments and for list
 * privacy. Third instance of one bug class.
 *
 * These two routes are covered here. The v1 chat messages route has the same
 * defect and is fixed on fix/v1-chat-mention-dispatch instead, because that
 * branch already edits the file and editing it from two branches buys a merge
 * conflict for nothing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api-auth-middleware', () => ({
  authenticateAPI: vi.fn().mockResolvedValue({ userId: 'user-1', source: 'session' }),
  getDeprecationWarning: () => null,
}))

vi.mock('@/lib/chat-access', () => ({
  canAccessChatChannel: vi.fn().mockResolvedValue(true),
  getChatChannelRecipients: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/api-auth-wrapper', () => ({
  withAuth: (_opts: unknown, handler: (...args: unknown[]) => unknown) =>
    (req: NextRequest, ctx: unknown) =>
      handler(req, { userId: 'user-1', scopes: ['chat:write'], source: 'oauth' }, ctx),
}))

const chatMessageCreate = vi.hoisted(() => vi.fn())
const channelFindUnique = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({
  prisma: {
    chatMessage: { create: chatMessageCreate, findUnique: vi.fn(), findFirst: vi.fn() },
    chatChannel: { findUnique: channelFindUnique },
    secureFile: { update: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}))

vi.mock('@/lib/sse-utils', () => ({ broadcastToUsers: vi.fn() }))

import { isV1CommentType, V1_COMMENT_TYPE_VALUES } from '@/lib/api-contracts/v1-request-shapes'

beforeEach(() => {
  vi.clearAllMocks()
  channelFindUnique.mockResolvedValue({ id: 'channel-1', listId: null })
})

describe('chat message type shares the CommentType enum (task 87e19910)', () => {
  it('is the same three values the comment routes accept', () => {
    // Stated as a test because the coupling is invisible in the code: the two
    // models reference one enum, so a value valid for a comment is valid for a
    // chat message and vice versa.
    expect(V1_COMMENT_TYPE_VALUES).toEqual(['TEXT', 'MARKDOWN', 'ATTACHMENT'])
    expect(isV1CommentType('BANANA')).toBe(false)
    expect(isV1CommentType('text')).toBe(false)
  })
})

describe('POST /api/chat/channels/:id/messages validates type (task 87e19910)', () => {
  function post(body: unknown) {
    return new NextRequest('http://localhost/api/chat/channels/channel-1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  const ctx = { params: Promise.resolve({ channelId: 'channel-1' }) } as never

  it('400s an unknown type instead of letting Prisma 500', async () => {
    const { POST } = await import('@/app/api/chat/channels/[channelId]/messages/route')

    const response = await POST(post({ content: 'hi', type: 'BANANA' }), ctx)

    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('TEXT')
    expect(chatMessageCreate).not.toHaveBeenCalled()
  })

  it('400s the lower-case spelling of a real type', async () => {
    const { POST } = await import('@/app/api/chat/channels/[channelId]/messages/route')

    expect((await POST(post({ content: 'hi', type: 'text' }), ctx)).status).toBe(400)
    expect(chatMessageCreate).not.toHaveBeenCalled()
  })
})
