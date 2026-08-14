/**
 * Reading a page of chat messages.
 *
 * `/api/chat/channels/:id/messages` and its v1 twin had byte-identical GET
 * bodies — the same clamp, the same take-one-extra trick, the same reverse, the
 * same cursor. Only auth and the response envelope differed. (Task e0613ae5.)
 *
 * Note this covers GET only. The two POSTs are NOT equivalent: legacy parses
 * @mentions and dispatches AI agents, v1 does neither, and legacy still accepts
 * the old attachmentUrl/Name/Type/Size fields that v1 dropped in favour of
 * SecureFile ids. Whether that is deliberate is an open question on the board
 * ("v1 chat POST dispatches no agent @mentions"), so those halves stay apart
 * until it is answered.
 */

import { prisma } from '@/lib/prisma'

export const MESSAGE_AUTHOR_SELECT = {
  id: true,
  name: true,
  email: true,
  image: true,
  isAIAgent: true,
  aiAgentType: true,
} as const

export const SECURE_FILE_SELECT = {
  id: true,
  originalName: true,
  mimeType: true,
  fileSize: true,
  createdAt: true,
} as const

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

export interface ChatMessagePage {
  messages: Array<Record<string, unknown>>
  hasMore: boolean
  nextCursor: string | null
}

/**
 * Fetch one page of a channel's messages, newest-first internally but returned
 * oldest-first for rendering.
 *
 * Paging runs BACKWARDS through history: `before` is an ISO timestamp and each
 * page returns the messages just older than it. That is why `nextCursor` is the
 * FIRST element after the reverse — the oldest message on this page — and why
 * feeding it back as `before` walks further into the past rather than looping.
 *
 * Access is the caller's job: both routes call canAccessChatChannel first, and
 * this function does not re-check.
 */
export async function fetchChatMessagePage(args: {
  channelId: string
  before?: string | null
  limit?: string | number | null
}): Promise<ChatMessagePage> {
  const { channelId, before } = args

  // A client asking for 5000 messages gets 100. NaN from a garbage `limit`
  // falls back to the default rather than propagating into the query.
  const requested = typeof args.limit === 'number'
    ? args.limit
    : parseInt(String(args.limit ?? ''), 10)
  const limit = Math.min(Number.isNaN(requested) ? DEFAULT_LIMIT : requested, MAX_LIMIT)

  const where: { channelId: string; createdAt?: { lt: Date } } = { channelId }
  if (before) {
    where.createdAt = { lt: new Date(before) }
  }

  // Take one more than asked for: if it comes back, there is another page.
  const messages = await prisma.chatMessage.findMany({
    where,
    include: {
      author: { select: MESSAGE_AUTHOR_SELECT },
      secureFiles: { select: SECURE_FILE_SELECT },
    },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
  })

  const hasMore = messages.length > limit
  if (hasMore) messages.pop()

  // Chronological for the client.
  messages.reverse()

  const nextCursor = hasMore && messages.length > 0
    ? messages[0].createdAt.toISOString()
    : null

  return {
    messages: messages.map(m => ({
      ...m,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
    })),
    hasMore,
    nextCursor,
  }
}
