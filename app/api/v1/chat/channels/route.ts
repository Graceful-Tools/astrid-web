/**
 * Chat Channels API
 *
 * POST /api/v1/chat/channels — get-or-create a channel for a listId or virtualKey
 *
 * Moved here from the legacy /api/chat/channels, which this route used to
 * re-export, when that path was deleted (AWTD-839). Authenticated through
 * withAuth with chat:write, like the other chat writes (AWTD-1402).
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { prisma } from '@/lib/prisma'
import { parseVirtualChatKey } from '@/lib/chat-channel-eligibility'
import { getUserRoleInList } from "@/lib/list-permissions"

export const POST = withAuth(
  { scopes: ['chat:write'], tag: 'v1.chat.channels' },
  async (req, auth) => {
    const body = await req.json()
    const { listId, virtualKey } = body

    if (!listId && !virtualKey) {
      return NextResponse.json(
        { error: 'Either listId or virtualKey is required' },
        { status: 400 }
      )
    }

    // For real list channels, verify the user has access to the list
    if (listId) {
      const list = await prisma.taskList.findUnique({
        where: { id: listId },
        include: { listMembers: true },
      })

      if (!list) {
        return NextResponse.json({ error: 'List not found' }, { status: 404 })
      }

      const isOwner = getUserRoleInList({ id: auth.userId }, list as never) === 'owner'
      const isMember = list.listMembers?.some(m => m.userId === auth.userId)
      const publicType = String((list as { publicListType?: string | null }).publicListType || '').toLowerCase()
      const isPublicCollaborative = list.privacy === 'PUBLIC' && publicType === 'collaborative'

      if (!isOwner && !isMember && !isPublicCollaborative) {
        return NextResponse.json({ error: 'Forbidden', code: 'LIST_ACCESS' }, { status: 403 })
      }

      // Get or create channel for this list
      const channel = await prisma.chatChannel.upsert({
        where: { listId },
        create: { listId, name: list.name },
        update: {},
      })

      return NextResponse.json({ channel })
    }

    // For virtual channels, verify the user owns the virtualKey
    if (virtualKey) {
      const parsed = parseVirtualChatKey(virtualKey)
      if (!parsed || parsed.userId !== auth.userId) {
        return NextResponse.json({ error: 'Forbidden', code: 'VIRTUAL_KEY' }, { status: 403 })
      }

      const channel = await prisma.chatChannel.upsert({
        where: { virtualKey },
        create: { virtualKey, name: parsed.type || 'Chat' },
        update: {},
      })

      return NextResponse.json({ channel })
    }

    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
)
