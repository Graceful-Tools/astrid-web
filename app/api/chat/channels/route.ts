/**
 * Chat Channels API
 *
 * POST /api/chat/channels — get-or-create a channel for a listId or virtualKey
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPI } from '@/lib/api-auth-middleware'
import { prisma } from '@/lib/prisma'
import { parseVirtualChatKey } from '@/lib/chat-channel-eligibility'
import { createLogger } from '@/lib/logger'
import { getUserRoleInList } from "@/lib/list-permissions"

const log = createLogger('chat.channels')


export async function POST(req: NextRequest) {
  try {
    const auth = await authenticateAPI(req)

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
  } catch (error: any) {
    if (error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    log.error({ err: error }, '[Chat API] POST /chat/channels error:')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
