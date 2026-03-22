import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockPrisma } from '../setup'

// Mock modules before importing route handlers
vi.mock('@/lib/api-auth-middleware', () => {
  class UnauthorizedError extends Error {
    name = 'UnauthorizedError'
  }
  class ForbiddenError extends Error {
    name = 'ForbiddenError'
  }
  return {
    authenticateAPI: vi.fn(),
    requireScopes: vi.fn(),
    getDeprecationWarning: vi.fn(),
    UnauthorizedError,
    ForbiddenError,
  }
})

vi.mock('@/lib/chat-access', () => ({
  canAccessChatChannel: vi.fn(),
  getChatChannelRecipients: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/sse-utils', () => ({
  broadcastToUsers: vi.fn(),
}))

import { GET, POST } from '@/app/api/v1/chat/channels/[channelId]/messages/route'
import { GET as GET_MESSAGE, PUT as PUT_MESSAGE, DELETE as DELETE_MESSAGE } from '@/app/api/v1/chat/messages/[id]/route'
import { authenticateAPI, requireScopes, getDeprecationWarning } from '@/lib/api-auth-middleware'
import { canAccessChatChannel, getChatChannelRecipients } from '@/lib/chat-access'
import { broadcastToUsers } from '@/lib/sse-utils'

const mockAuthenticateAPI = vi.mocked(authenticateAPI)
const mockRequireScopes = vi.mocked(requireScopes)
const mockGetDeprecationWarning = vi.mocked(getDeprecationWarning)
const mockCanAccessChatChannel = vi.mocked(canAccessChatChannel)
const mockGetChatChannelRecipients = vi.mocked(getChatChannelRecipients)
const mockBroadcastToUsers = vi.mocked(broadcastToUsers)

const CHANNEL_ID = 'channel-1'
const USER_ID = 'user-1'
const OTHER_USER_ID = 'user-2'

const createAuth = (userId = USER_ID) => ({
  userId,
  source: 'oauth' as const,
  scopes: ['chat:read', 'chat:write'],
})

const createMessage = (overrides: Partial<any> = {}) => ({
  id: 'msg-1',
  channelId: CHANNEL_ID,
  authorId: USER_ID,
  content: 'Hello world',
  type: 'TEXT',
  attachmentUrl: null,
  attachmentName: null,
  attachmentType: null,
  attachmentSize: null,
  replyToId: null,
  clientRequestId: null,
  createdAt: new Date('2026-03-29T10:00:00Z'),
  updatedAt: new Date('2026-03-29T10:00:00Z'),
  author: {
    id: USER_ID,
    name: 'Test User',
    email: 'test@example.com',
    image: null,
    isAIAgent: false,
    aiAgentType: null,
  },
  secureFiles: [],
  ...overrides,
})

const createSecureFile = (overrides: Partial<any> = {}) => ({
  id: 'file-1',
  originalName: 'photo.jpg',
  mimeType: 'image/jpeg',
  fileSize: 12345,
  createdAt: new Date('2026-03-29T10:00:00Z'),
  ...overrides,
})

describe('v1 Chat Message Attachments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireScopes.mockImplementation(() => {})
    mockGetDeprecationWarning.mockReturnValue(undefined)
    mockAuthenticateAPI.mockResolvedValue(createAuth() as any)
    mockCanAccessChatChannel.mockResolvedValue(true)
    mockGetChatChannelRecipients.mockResolvedValue([USER_ID, OTHER_USER_ID])
  })

  // ─── GET /api/v1/chat/channels/:channelId/messages ───

  describe('GET messages', () => {
    it('returns messages with secureFiles included', async () => {
      const file = createSecureFile()
      // findMany returns desc order, route reverses to chronological
      const messages = [
        createMessage({ id: 'msg-2', content: 'No attachment' }),
        createMessage({ secureFiles: [file] }),
      ]
      mockPrisma.chatMessage.findMany.mockResolvedValue(messages)

      const req = new Request(`http://localhost/api/v1/chat/channels/${CHANNEL_ID}/messages`)
      const res = await GET(req, { params: Promise.resolve({ channelId: CHANNEL_ID }) })
      const data = await res.json()

      expect(res.status).toBe(200)
      expect(data.messages).toHaveLength(2)
      // After reversal, first message has the file
      expect(data.messages[0].secureFiles).toHaveLength(1)
      expect(data.messages[0].secureFiles[0].originalName).toBe('photo.jpg')
      expect(data.messages[1].secureFiles).toHaveLength(0)
      expect(data.meta.apiVersion).toBe('v1')
    })

    it('rejects access when user cannot access channel', async () => {
      mockCanAccessChatChannel.mockResolvedValue(false)

      const req = new Request(`http://localhost/api/v1/chat/channels/${CHANNEL_ID}/messages`)
      const res = await GET(req, { params: Promise.resolve({ channelId: CHANNEL_ID }) })

      expect(res.status).toBe(403)
    })

    it('supports pagination with before cursor', async () => {
      mockPrisma.chatMessage.findMany.mockResolvedValue([])

      const req = new Request(`http://localhost/api/v1/chat/channels/${CHANNEL_ID}/messages?before=2026-03-29T10:00:00Z&limit=10`)
      const res = await GET(req, { params: Promise.resolve({ channelId: CHANNEL_ID }) })
      const data = await res.json()

      expect(res.status).toBe(200)
      expect(data.hasMore).toBe(false)
      expect(mockPrisma.chatMessage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            channelId: CHANNEL_ID,
            createdAt: { lt: expect.any(Date) },
          },
          take: 11,
        })
      )
    })
  })

  // ─── POST /api/v1/chat/channels/:channelId/messages ───

  describe('POST messages with attachments', () => {
    it('creates a message with fileId and associates SecureFile', async () => {
      const file = createSecureFile()
      const messageWithoutFile = createMessage()
      const messageWithFile = createMessage({ secureFiles: [file] })

      mockPrisma.chatMessage.create.mockResolvedValue(messageWithoutFile)
      mockPrisma.secureFile.update.mockResolvedValue({})
      mockPrisma.chatMessage.findUnique.mockResolvedValue(messageWithFile)

      const req = new Request(`http://localhost/api/v1/chat/channels/${CHANNEL_ID}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Hello world', fileId: 'file-1' }),
      })

      const res = await POST(req, { params: Promise.resolve({ channelId: CHANNEL_ID }) })
      const data = await res.json()

      expect(res.status).toBe(201)
      expect(data.message.secureFiles).toHaveLength(1)
      expect(data.message.secureFiles[0].id).toBe('file-1')

      // Verify SecureFile was associated
      expect(mockPrisma.secureFile.update).toHaveBeenCalledWith({
        where: {
          id: 'file-1',
          uploadedBy: USER_ID,
        },
        data: {
          chatMessageId: 'msg-1',
        },
      })
    })

    it('creates a message with only fileId (no content)', async () => {
      const file = createSecureFile()
      const messageWithFile = createMessage({ content: '', secureFiles: [file] })

      mockPrisma.chatMessage.create.mockResolvedValue(createMessage({ content: '' }))
      mockPrisma.secureFile.update.mockResolvedValue({})
      mockPrisma.chatMessage.findUnique.mockResolvedValue(messageWithFile)

      const req = new Request(`http://localhost/api/v1/chat/channels/${CHANNEL_ID}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '', fileId: 'file-1', type: 'ATTACHMENT' }),
      })

      const res = await POST(req, { params: Promise.resolve({ channelId: CHANNEL_ID }) })
      const data = await res.json()

      expect(res.status).toBe(201)
      expect(data.message.secureFiles).toHaveLength(1)
    })

    it('creates a message without attachment', async () => {
      const msg = createMessage()
      mockPrisma.chatMessage.create.mockResolvedValue(msg)

      const req = new Request(`http://localhost/api/v1/chat/channels/${CHANNEL_ID}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Just text' }),
      })

      const res = await POST(req, { params: Promise.resolve({ channelId: CHANNEL_ID }) })
      const data = await res.json()

      expect(res.status).toBe(201)
      expect(data.message.secureFiles).toHaveLength(0)
      expect(mockPrisma.secureFile.update).not.toHaveBeenCalled()
    })

    it('rejects message with no content and no fileId', async () => {
      const req = new Request(`http://localhost/api/v1/chat/channels/${CHANNEL_ID}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '' }),
      })

      const res = await POST(req, { params: Promise.resolve({ channelId: CHANNEL_ID }) })
      const data = await res.json()

      expect(res.status).toBe(400)
      expect(data.error).toBe('Content or file attachment is required')
    })

    it('handles idempotency with fileId', async () => {
      const file = createSecureFile()
      const existingMsg = createMessage({ clientRequestId: 'req-123', secureFiles: [file] })

      mockPrisma.chatMessage.findUnique.mockResolvedValue(existingMsg)

      const req = new Request(`http://localhost/api/v1/chat/channels/${CHANNEL_ID}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Hello', fileId: 'file-1', clientRequestId: 'req-123' }),
      })

      const res = await POST(req, { params: Promise.resolve({ channelId: CHANNEL_ID }) })
      const data = await res.json()

      expect(res.status).toBe(200)
      expect(data.message.secureFiles).toHaveLength(1)
      expect(mockPrisma.chatMessage.create).not.toHaveBeenCalled()
    })

    it('broadcasts message with attachment to other channel members', async () => {
      const msg = createMessage()
      mockPrisma.chatMessage.create.mockResolvedValue(msg)

      const req = new Request(`http://localhost/api/v1/chat/channels/${CHANNEL_ID}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Hello' }),
      })

      await POST(req, { params: Promise.resolve({ channelId: CHANNEL_ID }) })

      expect(mockBroadcastToUsers).toHaveBeenCalledWith(
        [OTHER_USER_ID],
        expect.objectContaining({
          type: 'chat_message_created',
          data: expect.objectContaining({
            channelId: CHANNEL_ID,
          }),
        })
      )
    })

    it('still creates message if SecureFile association fails', async () => {
      const msg = createMessage()
      mockPrisma.chatMessage.create.mockResolvedValue(msg)
      mockPrisma.secureFile.update.mockRejectedValue(new Error('File not found'))

      const req = new Request(`http://localhost/api/v1/chat/channels/${CHANNEL_ID}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Hello', fileId: 'nonexistent-file' }),
      })

      const res = await POST(req, { params: Promise.resolve({ channelId: CHANNEL_ID }) })

      expect(res.status).toBe(201)
    })
  })

  // ─── GET /api/v1/chat/messages/:id ───

  describe('GET single message', () => {
    it('returns message with secureFiles', async () => {
      const file = createSecureFile()
      const msg = createMessage({ secureFiles: [file] })
      mockPrisma.chatMessage.findUnique.mockResolvedValue(msg)

      const req = new Request('http://localhost/api/v1/chat/messages/msg-1')
      const res = await GET_MESSAGE(req, { params: Promise.resolve({ id: 'msg-1' }) })
      const data = await res.json()

      expect(res.status).toBe(200)
      expect(data.message.secureFiles).toHaveLength(1)
      expect(data.message.secureFiles[0].originalName).toBe('photo.jpg')
    })

    it('returns 404 for non-existent message', async () => {
      mockPrisma.chatMessage.findUnique.mockResolvedValue(null)

      const req = new Request('http://localhost/api/v1/chat/messages/nonexistent')
      const res = await GET_MESSAGE(req, { params: Promise.resolve({ id: 'nonexistent' }) })

      expect(res.status).toBe(404)
    })

    it('returns 404 when user cannot access channel', async () => {
      const msg = createMessage()
      mockPrisma.chatMessage.findUnique.mockResolvedValue(msg)
      mockCanAccessChatChannel.mockResolvedValue(false)

      const req = new Request('http://localhost/api/v1/chat/messages/msg-1')
      const res = await GET_MESSAGE(req, { params: Promise.resolve({ id: 'msg-1' }) })

      expect(res.status).toBe(404)
    })
  })

  // ─── PUT /api/v1/chat/messages/:id ───

  describe('PUT message', () => {
    it('updates message content and preserves secureFiles', async () => {
      const file = createSecureFile()
      mockPrisma.chatMessage.findUnique.mockResolvedValue({
        authorId: USER_ID,
        channelId: CHANNEL_ID,
      })
      mockPrisma.chatMessage.update.mockResolvedValue(
        createMessage({ content: 'Updated content', secureFiles: [file] })
      )

      const req = new Request('http://localhost/api/v1/chat/messages/msg-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Updated content' }),
      })

      const res = await PUT_MESSAGE(req, { params: Promise.resolve({ id: 'msg-1' }) })
      const data = await res.json()

      expect(res.status).toBe(200)
      expect(data.message.content).toBe('Updated content')
      expect(data.message.secureFiles).toHaveLength(1)
    })

    it('rejects update by non-author', async () => {
      mockPrisma.chatMessage.findUnique.mockResolvedValue({
        authorId: OTHER_USER_ID,
        channelId: CHANNEL_ID,
      })

      const req = new Request('http://localhost/api/v1/chat/messages/msg-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Hijack!' }),
      })

      const res = await PUT_MESSAGE(req, { params: Promise.resolve({ id: 'msg-1' }) })

      expect(res.status).toBe(403)
      expect(mockPrisma.chatMessage.update).not.toHaveBeenCalled()
    })

    it('rejects update with empty content', async () => {
      const req = new Request('http://localhost/api/v1/chat/messages/msg-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '' }),
      })

      const res = await PUT_MESSAGE(req, { params: Promise.resolve({ id: 'msg-1' }) })

      expect(res.status).toBe(400)
    })

    it('broadcasts update to other channel members', async () => {
      mockPrisma.chatMessage.findUnique.mockResolvedValue({
        authorId: USER_ID,
        channelId: CHANNEL_ID,
      })
      mockPrisma.chatMessage.update.mockResolvedValue(
        createMessage({ content: 'Updated' })
      )

      const req = new Request('http://localhost/api/v1/chat/messages/msg-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Updated' }),
      })

      await PUT_MESSAGE(req, { params: Promise.resolve({ id: 'msg-1' }) })

      expect(mockBroadcastToUsers).toHaveBeenCalledWith(
        [OTHER_USER_ID],
        expect.objectContaining({
          type: 'chat_message_updated',
        })
      )
    })
  })

  // ─── DELETE /api/v1/chat/messages/:id ───

  describe('DELETE message', () => {
    it('allows author to delete their message', async () => {
      mockPrisma.chatMessage.findUnique.mockResolvedValue({
        id: 'msg-1',
        authorId: USER_ID,
        channelId: CHANNEL_ID,
        channel: {
          list: {
            ownerId: OTHER_USER_ID,
            listMembers: [],
          },
        },
      })

      const req = new Request('http://localhost/api/v1/chat/messages/msg-1', {
        method: 'DELETE',
      })

      const res = await DELETE_MESSAGE(req, { params: Promise.resolve({ id: 'msg-1' }) })

      expect(res.status).toBe(200)
      expect(mockPrisma.chatMessage.delete).toHaveBeenCalledWith({ where: { id: 'msg-1' } })
    })

    it('allows list owner to delete any message', async () => {
      mockAuthenticateAPI.mockResolvedValue(createAuth(OTHER_USER_ID) as any)

      mockPrisma.chatMessage.findUnique.mockResolvedValue({
        id: 'msg-1',
        authorId: USER_ID,
        channelId: CHANNEL_ID,
        channel: {
          list: {
            ownerId: OTHER_USER_ID,
            listMembers: [],
          },
        },
      })

      const req = new Request('http://localhost/api/v1/chat/messages/msg-1', {
        method: 'DELETE',
      })

      const res = await DELETE_MESSAGE(req, { params: Promise.resolve({ id: 'msg-1' }) })

      expect(res.status).toBe(200)
    })

    it('allows list admin to delete any message', async () => {
      const adminId = 'admin-user'
      mockAuthenticateAPI.mockResolvedValue(createAuth(adminId) as any)

      mockPrisma.chatMessage.findUnique.mockResolvedValue({
        id: 'msg-1',
        authorId: USER_ID,
        channelId: CHANNEL_ID,
        channel: {
          list: {
            ownerId: OTHER_USER_ID,
            listMembers: [{ userId: adminId, role: 'admin' }],
          },
        },
      })

      const req = new Request('http://localhost/api/v1/chat/messages/msg-1', {
        method: 'DELETE',
      })

      const res = await DELETE_MESSAGE(req, { params: Promise.resolve({ id: 'msg-1' }) })

      expect(res.status).toBe(200)
    })

    it('rejects delete by non-author non-admin', async () => {
      const randomUser = 'random-user'
      mockAuthenticateAPI.mockResolvedValue(createAuth(randomUser) as any)

      mockPrisma.chatMessage.findUnique.mockResolvedValue({
        id: 'msg-1',
        authorId: USER_ID,
        channelId: CHANNEL_ID,
        channel: {
          list: {
            ownerId: OTHER_USER_ID,
            listMembers: [{ userId: randomUser, role: 'member' }],
          },
        },
      })

      const req = new Request('http://localhost/api/v1/chat/messages/msg-1', {
        method: 'DELETE',
      })

      const res = await DELETE_MESSAGE(req, { params: Promise.resolve({ id: 'msg-1' }) })

      expect(res.status).toBe(403)
      expect(mockPrisma.chatMessage.delete).not.toHaveBeenCalled()
    })

    it('broadcasts deletion to other channel members', async () => {
      mockPrisma.chatMessage.findUnique.mockResolvedValue({
        id: 'msg-1',
        authorId: USER_ID,
        channelId: CHANNEL_ID,
        channel: {
          list: {
            ownerId: USER_ID,
            listMembers: [],
          },
        },
      })

      const req = new Request('http://localhost/api/v1/chat/messages/msg-1', {
        method: 'DELETE',
      })

      await DELETE_MESSAGE(req, { params: Promise.resolve({ id: 'msg-1' }) })

      expect(mockBroadcastToUsers).toHaveBeenCalledWith(
        [OTHER_USER_ID],
        expect.objectContaining({
          type: 'chat_message_deleted',
          data: expect.objectContaining({
            messageId: 'msg-1',
          }),
        })
      )
    })

    it('returns 404 for non-existent message', async () => {
      mockPrisma.chatMessage.findUnique.mockResolvedValue(null)

      const req = new Request('http://localhost/api/v1/chat/messages/nonexistent', {
        method: 'DELETE',
      })

      const res = await DELETE_MESSAGE(req, { params: Promise.resolve({ id: 'nonexistent' }) })

      expect(res.status).toBe(404)
    })
  })
})
