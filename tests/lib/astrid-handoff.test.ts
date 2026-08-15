/**
 * Task f0700542 — the server half of the on-device Astrid handoff.
 *
 * The cases that matter are the ones where getting it wrong is worse than the
 * bug being fixed: dispatching twice, dispatching for a channel the caller
 * cannot read, or dispatching for a message that lives somewhere else.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const canAccessChatChannel = vi.hoisted(() => vi.fn())
vi.mock('@/lib/chat-access', () => ({ canAccessChatChannel }))

const resolveDefaultAgent = vi.hoisted(() => vi.fn())
vi.mock('@/lib/resolve-default-agent', () => ({ resolveDefaultAgent }))

const processAstridMessage = vi.hoisted(() => vi.fn())
vi.mock('@/lib/astrid-agent-runtime', () => ({ processAstridMessage }))

const broadcastToUsers = vi.hoisted(() => vi.fn())
vi.mock('@/lib/sse-utils', () => ({ broadcastToUsers }))

vi.mock('@/lib/astrid-agent', () => ({ ASTRID_EMAIL: 'astrid@astrid.cc' }))

const cacheGet = vi.hoisted(() => vi.fn())
const cacheSet = vi.hoisted(() => vi.fn())
vi.mock('@/lib/redis', () => ({ RedisCache: { get: cacheGet, set: cacheSet } }))

const messageFindUnique = vi.hoisted(() => vi.fn())
const channelFindUnique = vi.hoisted(() => vi.fn())
const userFindUnique = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({
  prisma: {
    chatMessage: { findUnique: messageFindUnique },
    chatChannel: { findUnique: channelFindUnique },
    user: { findUnique: userFindUnique },
  },
}))

import { handOffAstridReply, replyRequestId } from '@/lib/astrid-handoff'

const base = {
  channelId: 'channel-1',
  userId: 'user-1',
  userName: 'Jon',
  messageId: 'msg-1',
  content: 'what should I do today?',
}

beforeEach(() => {
  vi.clearAllMocks()
  canAccessChatChannel.mockResolvedValue(true)
  messageFindUnique.mockResolvedValue({ channelId: 'channel-1' })
  channelFindUnique.mockResolvedValue({ listId: 'list-1' })
  cacheGet.mockResolvedValue(null)
  cacheSet.mockResolvedValue(undefined)
  resolveDefaultAgent.mockResolvedValue('agent-astrid')
  userFindUnique.mockResolvedValue({ email: 'astrid@astrid.cc' })
  processAstridMessage.mockResolvedValue(undefined)
})

describe('handOffAstridReply (task f0700542)', () => {
  it('dispatches Astrid when she is the selected agent', async () => {
    const result = await handOffAstridReply(base)

    expect(result).toEqual({ ok: true, dispatched: 'astrid' })
    expect(processAstridMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessage: 'what should I do today?',
        channelId: 'channel-1',
        listId: 'list-1',
        replyClientRequestId: replyRequestId('msg-1'),
      })
    )
  })

  it('passes a DERIVED reply idempotency key, not one the caller chose', async () => {
    await handOffAstridReply(base)

    // ChatMessage.clientRequestId is unique, so this is what stops a racing
    // second generation from posting a duplicate reply. Deriving it means a
    // caller cannot collide with someone else's key.
    const passed = processAstridMessage.mock.calls[0][0].replyClientRequestId
    expect(passed).toBe('astrid-reply:msg-1')
  })

  it('refuses a repeat handoff for the same message without spending a model call', async () => {
    cacheGet.mockResolvedValue('user-1')

    const result = await handOffAstridReply(base)

    expect(result).toEqual({ ok: true, dispatched: 'none', reason: 'duplicate' })
    expect(processAstridMessage).not.toHaveBeenCalled()
    expect(broadcastToUsers).not.toHaveBeenCalled()
  })

  it('claims the message before dispatching, so a retry hits the claim', async () => {
    await handOffAstridReply(base)

    expect(cacheSet).toHaveBeenCalledWith('astrid-handoff:msg-1', 'user-1', expect.any(Number))
  })

  it('404s a channel the caller cannot access, without confirming it exists', async () => {
    canAccessChatChannel.mockResolvedValue(false)

    const result = await handOffAstridReply(base)

    expect(result).toEqual({ ok: false, status: 404, error: 'Channel not found' })
    expect(processAstridMessage).not.toHaveBeenCalled()
  })

  it('404s a message that belongs to a DIFFERENT channel', async () => {
    // Otherwise a caller could hand off an id from a channel they cannot read
    // and have the reply posted into one they can.
    messageFindUnique.mockResolvedValue({ channelId: 'someone-elses-channel' })

    const result = await handOffAstridReply(base)

    expect(result.ok).toBe(false)
    expect(processAstridMessage).not.toHaveBeenCalled()
  })

  it('404s a message that does not exist', async () => {
    messageFindUnique.mockResolvedValue(null)

    expect((await handOffAstridReply(base)).ok).toBe(false)
  })

  it('400s a missing message_id and a blank content', async () => {
    expect(await handOffAstridReply({ ...base, messageId: undefined })).toMatchObject({
      ok: false,
      status: 400,
    })
    expect(await handOffAstridReply({ ...base, content: '   ' })).toMatchObject({
      ok: false,
      status: 400,
    })
    expect(processAstridMessage).not.toHaveBeenCalled()
  })

  it('sends chat_mention when the selected agent is an external one', async () => {
    userFindUnique.mockResolvedValue({ email: 'other@agents.example' })

    const result = await handOffAstridReply(base)

    expect(result).toEqual({ ok: true, dispatched: 'external-agent' })
    expect(broadcastToUsers).toHaveBeenCalledWith(
      ['agent-astrid'],
      expect.objectContaining({ type: 'chat_mention' })
    )
    expect(processAstridMessage).not.toHaveBeenCalled()
  })

  it('reports no-agent rather than erroring when nothing is configured', async () => {
    resolveDefaultAgent.mockResolvedValue(null)

    // The client was right to hand off; there is simply nobody to answer.
    expect(await handOffAstridReply(base)).toEqual({
      ok: true,
      dispatched: 'none',
      reason: 'no-agent',
    })
  })
})
