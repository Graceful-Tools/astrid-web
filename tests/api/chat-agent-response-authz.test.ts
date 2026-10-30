/**
 * POST /api/chat/channels/:channelId/agent-response — authorization (AWTD-1341).
 *
 * Lets an on-device model post a message AS Astrid. The caller must be a
 * recipient of the channel (list owner/member, or the owner of a virtual
 * channel); anyone else is refused before a message is created or broadcast.
 * Uses the real lib/chat-access against a mocked prisma.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const authenticateAPI = vi.hoisted(() => vi.fn())
const userFindUnique = vi.hoisted(() => vi.fn())
const userFindFirst = vi.hoisted(() => vi.fn())
const channelFindUnique = vi.hoisted(() => vi.fn())
const messageCreate = vi.hoisted(() => vi.fn())
const broadcastToUsers = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-auth-middleware', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/api-auth-middleware')>()),
  authenticateAPI,
}))
vi.mock('@/lib/sse-utils', () => ({ broadcastToUsers }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: userFindUnique, findFirst: userFindFirst },
    chatChannel: { findUnique: channelFindUnique },
    chatMessage: { create: messageCreate },
  },
}))

import { UnauthorizedError } from '@/lib/api-auth-middleware'
import { POST } from '@/app/api/v1/chat/channels/[channelId]/agent-response/route'

const CHANNEL = {
  id: 'channel-1',
  virtualKey: null,
  list: { id: 'list-1', ownerId: 'owner-1', listMembers: [{ userId: 'member-1' }] },
}

const post = (channelId = 'channel-1') =>
  POST(
    new NextRequest(`http://localhost/api/chat/channels/${channelId}/agent-response`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'hello from the device' }),
    }),
    { params: Promise.resolve({ channelId }) },
  )
const signIn = (userId: string) => authenticateAPI.mockResolvedValue({ userId, source: 'session', scopes: ['*'] })

beforeEach(() => {
  vi.clearAllMocks()
  userFindUnique.mockResolvedValue({ aiAssistantSettings: JSON.stringify({ defaultAgentId: 'apple-foundation-model' }) })
  userFindFirst.mockResolvedValue({ id: 'astrid-1', name: 'Astrid', email: 'astrid', image: null, isAIAgent: true, aiAgentType: 'astrid' })
  channelFindUnique.mockImplementation(async ({ where }) => (where.id === 'channel-1' ? CHANNEL : null))
  messageCreate.mockImplementation(async ({ data }) => ({ id: 'm1', ...data, createdAt: new Date(), updatedAt: new Date() }))
})

function expectNothingPosted() {
  expect(messageCreate).not.toHaveBeenCalled()
  expect(broadcastToUsers).not.toHaveBeenCalled()
}

describe('POST /api/chat/channels/:channelId/agent-response authorization (AWTD-1341)', () => {
  it('AWTD-1341: refuses an unauthenticated caller with 401', async () => {
    authenticateAPI.mockRejectedValue(new UnauthorizedError('no'))
    expect((await post()).status).toBe(401)
    expectNothingPosted()
  })

  it('AWTD-1341: refuses a non-member of the channel with 403, even with an on-device model', async () => {
    signIn('stranger-1')
    const res = await post()
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('Not a member of this channel')
    expectNothingPosted()
  })

  it('AWTD-1341: refuses a channel that does not exist with 403', async () => {
    signIn('member-1')
    expect((await post('channel-missing')).status).toBe(403)
    expectNothingPosted()
  })

  it('AWTD-1341: refuses a member without an on-device model with 403', async () => {
    signIn('member-1')
    userFindUnique.mockResolvedValue({ aiAssistantSettings: JSON.stringify({ defaultAgentId: 'claude' }) })
    expect((await post()).status).toBe(403)
    expectNothingPosted()
  })

  it('AWTD-1341: a list member posts as Astrid (control)', async () => {
    signIn('member-1')
    const res = await post()
    expect(res.status).toBe(201)
    expect(messageCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ channelId: 'channel-1', authorId: 'astrid-1' }) }),
    )
  })
})
