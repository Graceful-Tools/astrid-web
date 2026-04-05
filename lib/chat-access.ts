/**
 * Chat channel access control utilities
 */

import { parseVirtualChatKey } from '@/lib/chat-channel-eligibility'
import { prisma } from '@/lib/prisma'

/**
 * Check if a user can access a chat channel.
 * - Real list channels: user must be list owner or member
 * - Virtual channels: user must own the virtual key
 */
export async function canAccessChatChannel(
  channelId: string,
  userId: string
): Promise<boolean> {
  const channel = await prisma.chatChannel.findUnique({
    where: { id: channelId },
    include: {
      list: {
        include: {
          listMembers: true,
        },
      },
    },
  })

  if (!channel) return false

  // Virtual channel: only the user whose ID is in the virtualKey
  if (channel.virtualKey) {
    const parsed = parseVirtualChatKey(channel.virtualKey)
    return parsed?.userId === userId
  }

  // Real list channel: check list membership
  if (channel.list) {
    if (channel.list.ownerId === userId) return true
    if (channel.list.listMembers?.some(m => m.userId === userId)) return true
    // Public collaborative lists allow access
    if (channel.list.privacy === 'PUBLIC' && channel.list.publicListType === 'collaborative') return true
    return false
  }

  return false
}

/**
 * Get user IDs who should receive broadcasts for a channel
 */
export async function getChatChannelRecipients(channelId: string): Promise<string[]> {
  const channel = await prisma.chatChannel.findUnique({
    where: { id: channelId },
    include: {
      list: {
        include: {
          listMembers: true,
        },
      },
    },
  })

  if (!channel) return []

  // Virtual channel: just the owner
  if (channel.virtualKey) {
    const parsed = parseVirtualChatKey(channel.virtualKey)
    return parsed ? [parsed.userId] : []
  }

  // Real list channel: all list members + owner
  if (channel.list) {
    const userIds = new Set<string>()
    userIds.add(channel.list.ownerId)
    channel.list.listMembers?.forEach(m => userIds.add(m.userId))
    return Array.from(userIds)
  }

  return []
}
