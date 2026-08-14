/**
 * RED for task 26311472 — v1 chat POST dispatched no @mentions at all.
 *
 * Jon: "Check the IOS repo. If it is a bug. The fix if needed." Reading
 * astrid-ios settled it, and the answer is finer-grained than the task
 * assumed — iOS covers exactly one of the three mention kinds:
 *
 *   human          iOS does NOTHING. Its only mention notification comes from
 *                  a COMMENT sse event, not chat. So @mentioning a person from
 *                  iOS sent them no push at all. The most user-visible of the
 *                  three, and not identified when the task was filed.
 *   external agent iOS does NOTHING. OnDeviceAstrid matches only `@[Astrid]`.
 *   Astrid         iOS DOES handle it, on device, POSTing to
 *                  /api/v1/chat/channels/:id/agent-response.
 *
 * So the first two are dispatched server-side now and Astrid deliberately is
 * not — dispatching her too would give an iOS user two answers to one message.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const findMany = vi.hoisted(() => vi.fn())
const findUnique = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findMany },
    chatChannel: { findUnique },
  },
}))

const broadcastToUsers = vi.hoisted(() => vi.fn())
vi.mock('@/lib/sse-utils', () => ({ broadcastToUsers }))

const sendChatMentionNotification = vi.hoisted(() => vi.fn())
vi.mock('@/lib/push-notification-service', () => ({
  PushNotificationService: class {
    sendChatMentionNotification = sendChatMentionNotification
  },
}))

vi.mock('@/lib/astrid-agent', () => ({ ASTRID_EMAIL: 'astrid@astrid.cc' }))

import { dispatchChatMentions } from '@/lib/chat-mention-dispatch'

const SENDER = 'user-sender'
const base = {
  channelId: 'channel-1',
  messageId: 'msg-1',
  senderId: SENDER,
  senderName: 'Sender',
}

const mention = (id: string, name = 'Someone') => `@[${name}](${id})`

beforeEach(() => {
  vi.clearAllMocks()
  findUnique.mockResolvedValue({ listId: 'list-1' })
})

describe('dispatchChatMentions (task 26311472)', () => {
  it('pushes to a mentioned human', async () => {
    findMany.mockResolvedValue([{ id: 'user-human', isAIAgent: false, email: 'a@b.c' }])

    await dispatchChatMentions({ ...base, content: `hey ${mention('user-human')}` })

    expect(sendChatMentionNotification).toHaveBeenCalledWith('user-human', expect.objectContaining({
      channelId: 'channel-1',
      messageId: 'msg-1',
      senderName: 'Sender',
    }))
  })

  it('emits chat_mention to an external agent', async () => {
    findMany.mockResolvedValue([{ id: 'agent-x', isAIAgent: true, email: 'x@agents.example' }])

    const result = await dispatchChatMentions({ ...base, content: mention('agent-x', 'Agent X') })

    expect(broadcastToUsers).toHaveBeenCalledWith(['agent-x'], expect.objectContaining({
      type: 'chat_mention',
    }))
    expect(result.agentMentioned).toBe(true)
  })

  it('does NOT dispatch Astrid — iOS answers her on device, and two answers is worse than none', async () => {
    findMany.mockResolvedValue([{ id: 'agent-astrid', isAIAgent: true, email: 'astrid@astrid.cc' }])

    const result = await dispatchChatMentions({ ...base, content: mention('agent-astrid', 'Astrid') })

    expect(broadcastToUsers).not.toHaveBeenCalled()
    expect(sendChatMentionNotification).not.toHaveBeenCalled()
    // Still reported as mentioned: legacy uses this to suppress its
    // personal-channel auto-response, and an explicit @Astrid must suppress it.
    expect(result.agentMentioned).toBe(true)
  })

  it('never notifies the sender for mentioning themselves', async () => {
    findMany.mockResolvedValue([])

    await dispatchChatMentions({ ...base, content: mention(SENDER, 'Me') })

    expect(findMany).not.toHaveBeenCalled()
    expect(sendChatMentionNotification).not.toHaveBeenCalled()
  })

  it('sends one push when the same person is mentioned twice', async () => {
    findMany.mockResolvedValue([{ id: 'user-human', isAIAgent: false, email: 'a@b.c' }])

    await dispatchChatMentions({
      ...base,
      content: `${mention('user-human')} and again ${mention('user-human')}`,
    })

    expect(sendChatMentionNotification).toHaveBeenCalledTimes(1)
  })

  it('does no work and no queries when there are no mentions', async () => {
    await dispatchChatMentions({ ...base, content: 'just a normal message' })

    expect(findMany).not.toHaveBeenCalled()
    expect(broadcastToUsers).not.toHaveBeenCalled()
  })

  it('tolerates null content', async () => {
    await expect(dispatchChatMentions({ ...base, content: null })).resolves.toEqual({
      agentMentioned: false,
    })
  })

  it('does not let a failed push throw — the message is already saved', async () => {
    findMany.mockResolvedValue([{ id: 'user-human', isAIAgent: false, email: 'a@b.c' }])
    sendChatMentionNotification.mockRejectedValue(new Error('APNs down'))

    await expect(
      dispatchChatMentions({ ...base, content: mention('user-human') })
    ).resolves.toBeDefined()
  })
})
