import { describe, it, expect, vi, beforeEach } from 'vitest'
import { canAccessChatChannel, getChatChannelRecipients } from '@/lib/chat-access'
import { prisma } from '@/lib/prisma'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    chatChannel: {
      findUnique: vi.fn(),
    },
  },
}))

const mockFindUnique = prisma.chatChannel.findUnique as ReturnType<typeof vi.fn>

describe('chat-access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('canAccessChatChannel', () => {
    it('should return false if channel not found', async () => {
      mockFindUnique.mockResolvedValue(null)
      expect(await canAccessChatChannel('ch-1', 'user-1')).toBe(false)
    })

    it('should allow access to virtual channel owner', async () => {
      mockFindUnique.mockResolvedValue({
        id: 'ch-1',
        virtualKey: 'virtual-chat:user-1:my-tasks',
        list: null,
      })
      expect(await canAccessChatChannel('ch-1', 'user-1')).toBe(true)
    })

    it('should deny access to virtual channel for other users', async () => {
      mockFindUnique.mockResolvedValue({
        id: 'ch-1',
        virtualKey: 'virtual-chat:user-1:my-tasks',
        list: null,
      })
      expect(await canAccessChatChannel('ch-1', 'user-2')).toBe(false)
    })

    it('should allow access to list owner', async () => {
      mockFindUnique.mockResolvedValue({
        id: 'ch-1',
        virtualKey: null,
        list: {
          ownerId: 'user-1',
          privacy: 'PRIVATE',
          publicListType: null,
          listMembers: [],
        },
      })
      expect(await canAccessChatChannel('ch-1', 'user-1')).toBe(true)
    })

    it('should allow access to list member', async () => {
      mockFindUnique.mockResolvedValue({
        id: 'ch-1',
        virtualKey: null,
        list: {
          ownerId: 'user-1',
          privacy: 'PRIVATE',
          publicListType: null,
          listMembers: [{ userId: 'user-2' }],
        },
      })
      expect(await canAccessChatChannel('ch-1', 'user-2')).toBe(true)
    })

    it('should deny access to non-member on private list', async () => {
      mockFindUnique.mockResolvedValue({
        id: 'ch-1',
        virtualKey: null,
        list: {
          ownerId: 'user-1',
          privacy: 'PRIVATE',
          publicListType: null,
          listMembers: [],
        },
      })
      expect(await canAccessChatChannel('ch-1', 'user-3')).toBe(false)
    })

    it('should allow access to collaborative public list', async () => {
      mockFindUnique.mockResolvedValue({
        id: 'ch-1',
        virtualKey: null,
        list: {
          ownerId: 'user-1',
          privacy: 'PUBLIC',
          publicListType: 'collaborative',
          listMembers: [],
        },
      })
      expect(await canAccessChatChannel('ch-1', 'user-anyone')).toBe(true)
    })

    it('should deny access to non-collaborative public list', async () => {
      mockFindUnique.mockResolvedValue({
        id: 'ch-1',
        virtualKey: null,
        list: {
          ownerId: 'user-1',
          privacy: 'PUBLIC',
          publicListType: 'copy_only',
          listMembers: [],
        },
      })
      expect(await canAccessChatChannel('ch-1', 'user-anyone')).toBe(false)
    })
  })

  describe('getChatChannelRecipients', () => {
    it('should return empty for non-existent channel', async () => {
      mockFindUnique.mockResolvedValue(null)
      expect(await getChatChannelRecipients('ch-1')).toEqual([])
    })

    it('should return virtual channel owner', async () => {
      mockFindUnique.mockResolvedValue({
        id: 'ch-1',
        virtualKey: 'virtual-chat:user-1:my-tasks',
        list: null,
      })
      expect(await getChatChannelRecipients('ch-1')).toEqual(['user-1'])
    })

    it('should return list owner and all members', async () => {
      mockFindUnique.mockResolvedValue({
        id: 'ch-1',
        virtualKey: null,
        list: {
          ownerId: 'user-1',
          listMembers: [{ userId: 'user-2' }, { userId: 'user-3' }],
        },
      })
      const recipients = await getChatChannelRecipients('ch-1')
      expect(recipients).toContain('user-1')
      expect(recipients).toContain('user-2')
      expect(recipients).toContain('user-3')
      expect(recipients.length).toBe(3)
    })

    it('should deduplicate owner who is also a member', async () => {
      mockFindUnique.mockResolvedValue({
        id: 'ch-1',
        virtualKey: null,
        list: {
          ownerId: 'user-1',
          listMembers: [{ userId: 'user-1' }, { userId: 'user-2' }],
        },
      })
      const recipients = await getChatChannelRecipients('ch-1')
      expect(recipients.length).toBe(2)
      expect(recipients).toContain('user-1')
      expect(recipients).toContain('user-2')
    })
  })
})
