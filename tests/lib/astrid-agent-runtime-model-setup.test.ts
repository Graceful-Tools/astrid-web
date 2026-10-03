/**
 * AWTD-1054 — processAstridMessage must not go silent when it cannot answer.
 *
 * With an on-device model (Apple Foundation Models) selected, it used to return
 * early on the theory that iOS was answering. But nothing that reaches this
 * function can run that model: the web client never can, and the iOS handoff
 * only calls the server once the device has declined. So the early return was
 * silence. It now posts the on-device variant of the setup prompt.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const userFindFirst = vi.hoisted(() => vi.fn())
const userFindUnique = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findFirst: userFindFirst, findUnique: userFindUnique },
    chatMessage: { create: vi.fn() },
  },
}))

const getAIServiceCredential = vi.hoisted(() => vi.fn())
const getPreferredAIService = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-key-cache', () => ({ getAIServiceCredential, getPreferredAIService }))

vi.mock('@/lib/sse-utils', () => ({ broadcastToUsers: vi.fn() }))
vi.mock('@/lib/chat-access', () => ({ getChatChannelRecipients: vi.fn().mockResolvedValue(['user-1']) }))
vi.mock('@/lib/astrid-agent/typing-indicator', () => ({ startTyping: vi.fn(), stopTyping: vi.fn() }))

const dispatchToolCall = vi.hoisted(() => vi.fn())
vi.mock('@/lib/astrid-agent/dispatch-ai-service', () => ({ dispatchToolCall }))

const postAstridModelSetupPrompt = vi.hoisted(() => vi.fn())
vi.mock('@/lib/astrid-agent/model-setup-prompt', () => ({ postAstridModelSetupPrompt }))

import { processAstridMessage } from '@/lib/astrid-agent-runtime'

const params = {
  userMessage: 'hi',
  userId: 'user-1',
  userName: 'Jon',
  channelId: 'channel-1',
  listId: null,
  locale: 'ja',
  replyClientRequestId: 'astrid-reply:msg-1',
}

beforeEach(() => {
  vi.clearAllMocks()
  userFindFirst.mockResolvedValue({ id: 'astrid-id', name: 'Astrid' })
  getPreferredAIService.mockResolvedValue('claude')
  postAstridModelSetupPrompt.mockResolvedValue(undefined)
})

describe('processAstridMessage with no usable model (AWTD-1054)', () => {
  it('posts the on-device prompt instead of returning silently', async () => {
    userFindUnique.mockResolvedValue({
      aiAssistantSettings: JSON.stringify({ defaultAgentId: 'apple-foundation-model' }),
    })

    await processAstridMessage(params)

    expect(postAstridModelSetupPrompt).toHaveBeenCalledWith({
      channelId: 'channel-1',
      reason: 'on-device',
      locale: 'ja',
      clientRequestId: 'astrid-reply:msg-1',
    })
    expect(dispatchToolCall).not.toHaveBeenCalled()
  })

  it('posts the no-key prompt, in the caller locale, when the preferred service has no key', async () => {
    userFindUnique.mockResolvedValue({ aiAssistantSettings: null })
    getAIServiceCredential.mockResolvedValue(null)

    await processAstridMessage(params)

    expect(postAstridModelSetupPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'no-key', locale: 'ja' })
    )
    expect(dispatchToolCall).not.toHaveBeenCalled()
  })
})
